// Entrada do Vercel: todas as rotas /api/* caem aqui (rewrites em vercel.json) e vão para o
// mesmo app Express do servidor local. Os dados ficam no Upstash (server/src/services/datafs.js).
import app from "../server/src/index.js";
import { restoreUrl } from "./_url.mjs";

export default function handler(req, res) {
  req.url = restoreUrl(req.url);
  return app(req, res);
}
