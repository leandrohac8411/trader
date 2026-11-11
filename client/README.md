# client

Front-end (React 19 + Vite) do crypto-dashboard. Veja o [README da raiz](../README.md).

```bash
npm install
npm run dev     # http://localhost:5173  (proxy /api -> localhost:4000)
npm run build
npm run lint
```

Estrutura:

- `src/services/api.js` — cliente HTTP único (timeout + retry).
- `src/components/` — `Header`, `MarketOverview`, `TradingPairs`, `TVChart`, `AIAssistant`.

Variáveis (opcionais) em `.env.local` — veja `.env.example`.
