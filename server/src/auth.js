// server/src/auth.js
// Autenticação mínima (HTTP Basic) para quando o servidor sai do loopback.
import { timingSafeEqual, createHash } from "node:crypto";

const digest = (v) => createHash("sha256").update(String(v)).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

export function isLoopback(host) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(String(host).toLowerCase());
}

/** Middleware: exige usuário/senha em todas as rotas exceto `open`. */
export function basicAuth({ user, password, open = [], realm = "Escritorio" }) {
  if (!password) throw Error("basicAuth precisa de senha.");
  return (req, res, next) => {
    if (open.includes(req.path)) return next();
    const [scheme, encoded] = String(req.get("authorization") || "").split(" ");
    if (scheme === "Basic" && encoded) {
      const raw = Buffer.from(encoded, "base64").toString("utf8");
      const i = raw.indexOf(":");
      if (i >= 0 && same(raw.slice(0, i), user) & same(raw.slice(i + 1), password)) return next();
    }
    res.set("WWW-Authenticate", `Basic realm="${realm}", charset="UTF-8"`);
    res.status(401).json({ error: "autenticação necessária" });
  };
}
