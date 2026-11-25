import { handleApiRequest } from "../../src/core/handlers.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const result = await handleApiRequest({
    pathname: url.pathname,
    searchParams: url.searchParams,
    method: context.request.method,
    headers: {},
  });
  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
