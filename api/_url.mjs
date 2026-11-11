// (arquivos com "_" em /api não viram rotas no Vercel)
// O rewrite manda o caminho original em ?__path=... ; reconstrói req.url para o Express.
// Se a plataforma já entregar o caminho original, devolve como veio.
export function restoreUrl(url) {
  const u = new URL(url, "http://local");
  const path = u.searchParams.get("__path");
  if (path == null) return url;
  u.searchParams.delete("__path");
  const qs = u.searchParams.toString();
  return `/api/${path.replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;
}
