import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// sem StrictMode para não duplicar montagem do TradingView
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
