import {
  CHAINS,
  ERC20_TRANSFER_TOPIC,
  TREASURY_ADDRESS,
  TREASURY_LOWER,
} from "./config.js";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

async function defaultRpcCall(rpcs, method, params) {
  let lastErr;
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        lastErr = new Error(`RPC HTTP ${res.status} from ${rpc}`);
        continue;
      }
      const json = await res.json();
      if (json.error) {
        lastErr = new Error(`RPC error: ${json.error.message || JSON.stringify(json.error)}`);
        continue;
      }
      return json.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("All RPC endpoints failed");
}

export function extractUsdcTransferToTreasury(receipt, chainCfg) {
  if (!receipt || receipt.status !== "0x1" || !Array.isArray(receipt.logs)) {
    return null;
  }
  let best = null;
  for (const log of receipt.logs) {
    const tokenAddr = (log.address || "").toLowerCase();
    const tokenInfo = chainCfg.tokens[tokenAddr];
    if (!tokenInfo) continue;
    if (!Array.isArray(log.topics) || log.topics.length < 3) continue;
    if ((log.topics[0] || "").toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;

    const toAddr = "0x" + log.topics[2].slice(-40).toLowerCase();
    if (toAddr !== TREASURY_LOWER) continue;

    const fromAddr = "0x" + log.topics[1].slice(-40).toLowerCase();
    const amountAtomic = BigInt(log.data || "0x0");
    if (!best || amountAtomic > best.amountAtomic) {
      best = {
        from: fromAddr,
        to: TREASURY_ADDRESS,
        tokenSymbol: tokenInfo.symbol,
        tokenAddress: tokenInfo.address,
        amountAtomic,
        amountUsdc: Number(amountAtomic) / 10 ** tokenInfo.decimals,
      };
    }
  }
  return best;
}

export async function verifyOnSingleChain(
  txHash,
  chainCfg,
  minAmountAtomic,
  maxAgeSeconds,
  { rpcCall = defaultRpcCall, minConfirmations = 2 } = {}
) {
  const receipt = await rpcCall(chainCfg.rpcs, "eth_getTransactionReceipt", [txHash], chainCfg.key);
  if (!receipt) {
    return { ok: false, reason: "not_found", chain: chainCfg.key };
  }
  if (receipt.status !== "0x1") {
    return { ok: false, reason: "tx_reverted", chain: chainCfg.key };
  }

  const transfer = extractUsdcTransferToTreasury(receipt, chainCfg);
  if (!transfer) {
    return {
      ok: false,
      reason: "no_usdc_transfer_to_treasury",
      chain: chainCfg.key,
    };
  }
  if (transfer.amountAtomic < minAmountAtomic) {
    return {
      ok: false,
      reason: "insufficient_amount",
      chain: chainCfg.key,
      receivedUsdc: transfer.amountUsdc,
      requiredUsdc: Number(minAmountAtomic) / 1e6,
    };
  }

  const receiptBlock = parseInt(receipt.blockNumber, 16);
  if (!Number.isFinite(receiptBlock)) {
    return { ok: false, reason: "block_timestamp_unavailable", chain: chainCfg.key };
  }

  // Require >= minConfirmations (e.g. 2 confirmations)
  const latestHex = await rpcCall(chainCfg.rpcs, "eth_blockNumber", [], chainCfg.key);
  const latestBlock = parseInt(latestHex, 16);
  if (!Number.isFinite(latestBlock)) {
    return { ok: false, reason: "rpc_error", chain: chainCfg.key, message: "Invalid latest block number" };
  }
  const confirmations = latestBlock - receiptBlock + 1;
  if (confirmations < minConfirmations) {
    return {
      ok: false,
      reason: "insufficient_confirmations",
      chain: chainCfg.key,
      confirmations,
      requiredConfirmations: minConfirmations,
    };
  }

  // Fail-closed block timestamp check
  let block;
  try {
    block = await rpcCall(chainCfg.rpcs, "eth_getBlockByNumber", [receipt.blockNumber, false], chainCfg.key);
  } catch (err) {
    return {
      ok: false,
      reason: "block_timestamp_unavailable",
      chain: chainCfg.key,
      message: err?.message || "Failed to fetch block timestamp",
    };
  }
  if (!block || !block.timestamp) {
    return {
      ok: false,
      reason: "block_timestamp_unavailable",
      chain: chainCfg.key,
      message: "Block timestamp missing from RPC response",
    };
  }

  const blockTimestamp = parseInt(block.timestamp, 16);
  const age = Math.floor(Date.now() / 1000) - blockTimestamp;
  if (maxAgeSeconds && age > maxAgeSeconds) {
    return {
      ok: false,
      reason: "payment_expired",
      chain: chainCfg.key,
      ageSeconds: age,
      maxAgeSeconds,
    };
  }

  return {
    ok: true,
    chain: chainCfg.key,
    chainName: chainCfg.name,
    chainId: chainCfg.chainId,
    txHash,
    explorerUrl: `${chainCfg.explorerTx}${txHash}`,
    blockNumber: receiptBlock,
    confirmations,
    blockTimestamp,
    ...transfer,
    amountAtomic: transfer.amountAtomic.toString(),
  };
}

export async function verifyUsdcPayment({
  txHash,
  chain = "auto",
  minAmountAtomic,
  maxAgeSeconds = 30 * 24 * 3600,
  minConfirmations = 2,
  rpcCall = defaultRpcCall,
}) {
  if (!txHash || !TX_HASH_RE.test(txHash.trim())) {
    return {
      ok: false,
      reason: "invalid_tx_hash",
      message: "Transaction hash must be a valid 66-character 0x EVM hash.",
    };
  }
  const cleanTx = txHash.trim();
  const chainKeys =
    chain && chain !== "auto" && CHAINS[chain]
      ? [chain]
      : ["base", "polygon"];

  const results = await Promise.all(
    chainKeys.map((k) =>
      verifyOnSingleChain(cleanTx, CHAINS[k], minAmountAtomic, maxAgeSeconds, {
        rpcCall,
        minConfirmations,
      }).catch((err) => ({ ok: false, reason: "rpc_error", chain: k, message: err.message }))
    )
  );

  const success = results.find((r) => r.ok);
  if (success) return success;

  const priorityOrder = [
    "insufficient_amount",
    "no_usdc_transfer_to_treasury",
    "tx_reverted",
    "payment_expired",
    "insufficient_confirmations",
    "block_timestamp_unavailable",
    "rpc_error",
  ];
  let specific = null;
  for (const reason of priorityOrder) {
    specific = results.find((r) => r.reason === reason);
    if (specific) break;
  }
  specific = specific || results[0];

  const messages = {
    not_found:
      "Transaction not found on Base or Polygon yet. Wait 2-5 seconds for confirmation and retry.",
    tx_reverted: "Transaction reverted on-chain.",
    no_usdc_transfer_to_treasury: `No official USDC transfer to ${TREASURY_ADDRESS} found in this transaction.`,
    insufficient_amount: `Received ${specific.receivedUsdc ?? 0} USDC, but at least ${specific.requiredUsdc} USDC is required.`,
    payment_expired: "Payment transaction is older than the allowed validity window.",
    insufficient_confirmations: `Waiting for ${specific.requiredConfirmations ?? 2} block confirmations (currently ${specific.confirmations ?? 1}). Retry in a few seconds.`,
    block_timestamp_unavailable: "Unable to verify transaction block timestamp on RPC. Please retry.",
    rpc_error: `Unable to reach blockchain RPC: ${specific.message || "unknown error"}`,
  };

  return {
    ...specific,
    message: messages[specific.reason] || "Payment verification failed.",
  };
}

export function buildPaymentRequiredResponse({
  resource,
  description,
  priceUsdc,
  priceAtomic,
}) {
  return {
    error: "payment_required",
    resource,
    description,
    priceUsdc,
    payTo: TREASURY_ADDRESS,
    accepts: [
      {
        scheme: "exact",
        network: "base",
        chainId: CHAINS.base.chainId,
        asset: CHAINS.base.defaultToken,
        symbol: "USDC",
        maxAmountRequired: priceAtomic.toString(),
        payTo: TREASURY_ADDRESS,
      },
      {
        scheme: "exact",
        network: "polygon",
        chainId: CHAINS.polygon.chainId,
        asset: CHAINS.polygon.defaultToken,
        symbol: "USDC",
        maxAmountRequired: priceAtomic.toString(),
        payTo: TREASURY_ADDRESS,
      },
      {
        scheme: "exact",
        network: "polygon",
        chainId: CHAINS.polygon.chainId,
        asset: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        symbol: "USDC.e",
        maxAmountRequired: priceAtomic.toString(),
        payTo: TREASURY_ADDRESS,
      },
    ],
    howToPay: {
      human: `Send ${priceUsdc} USDC on Base or Polygon to ${TREASURY_ADDRESS}, then submit the tx hash.`,
    },
  };
}
