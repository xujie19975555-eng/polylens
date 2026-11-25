export const TREASURY_ADDRESS = "0xcC52589F7F1E8b95101e8454CeAA3742533f7FF6";
export const TREASURY_LOWER = TREASURY_ADDRESS.toLowerCase();

export const PRICING = {
  proReportUsdc: 3,
  proReportAtomic: 3_000_000n,
  taxExportUsdc: 7,
  taxExportAtomic: 7_000_000n,
  x402CallUsdc: 0.05,
  x402CallAtomic: 50_000n,
};

export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const CHAINS = {
  base: {
    key: "base",
    name: "Base",
    chainId: 8453,
    chainIdHex: "0x2105",
    explorerTx: "https://basescan.org/tx/",
    rpcs: [
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com",
    ],
    tokens: {
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
        symbol: "USDC",
        decimals: 6,
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
    },
    defaultToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  polygon: {
    key: "polygon",
    name: "Polygon",
    chainId: 137,
    chainIdHex: "0x89",
    explorerTx: "https://polygonscan.com/tx/",
    rpcs: [
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon-rpc.com",
    ],
    tokens: {
      "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": {
        symbol: "USDC",
        decimals: 6,
        address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      },
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": {
        symbol: "USDC.e",
        decimals: 6,
        address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      },
    },
    defaultToken: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
};
