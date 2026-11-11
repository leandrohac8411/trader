import React, { useState } from "react";
import Header from "./components/Header.jsx";
import MarketOverview from "./components/MarketOverview.jsx";

import TradingPairs from "./components/TradingPairs.jsx";
import TVChart from "./components/TVChart.jsx";
import AIAssistant from "./components/AIAssistant.jsx";
import Backtest from "./components/Backtest.jsx";
import DemoBot from "./components/DemoBot.jsx";

export default function Dashboard() {
  // símbolo “global” do gráfico
  const [chartSymbol, setChartSymbol] = useState("BTCUSDT");
  // se quiser também controlar o timeframe do gráfico:
  const [chartInterval, setChartInterval] = useState("1"); // 1m

  return (
    <div className="min-h-dvh flex flex-col">
      <Header />

      <main className="flex-1 w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Top cards */}
        <MarketOverview />

        {/* LINHA 1: Trading Pairs + IA */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className="lg:col-span-2">
            <TradingPairs maxRows={8} maxHeight={380} />
          </div>
          <div>
            <AIAssistant
              initialSymbol={chartSymbol}
              initialInterval="1"
              initialLimit={120}
              autoRefresh={true}
              refreshMs={60_000}
              // sempre que o usuário trocar a moeda na IA, atualiza o gráfico:
              onSymbolChange={(sym) => setChartSymbol(sym)}
              // se quiser também refletir timeframe:
              onIntervalChange={(iv) => setChartInterval(iv)}
            />
          </div>
        </section>

        {/* LINHA 2: gráfico full-width */}
        <section className="mb-6 sm:mb-8">
          <div className="bg-white rounded-xl shadow p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
                Gráfico — {chartSymbol}
              </h2>
              {/* botões de timeframe do gráfico (opcional) */}
              <div className="flex items-center gap-2">
                {["1","5","15","60","240","D"].map(iv => (
                  <button
                    key={iv}
                    onClick={() => setChartInterval(iv)}
                    className={`px-3 py-1 rounded text-sm ${
                      chartInterval === iv ? "bg-blue-500 text-white" : "bg-gray-100"
                    }`}
                  >
                    {iv === "D" ? "1d" : `${iv}m`}
                  </button>
                ))}
              </div>
            </div>

            {/* força remount do widget quando símbolo/timeframe mudar */}
            <div className="w-full" style={{ height: "68vh" }}>
              <TVChart
                key={`${chartSymbol}-${chartInterval}`}
                exchange="BINANCE"
                symbol={chartSymbol}
                interval={chartInterval}
              />
            </div>
          </div>
        </section>

        {/* LINHA 3: backtest / calibração */}
        <section className="mb-6 sm:mb-8">
          <Backtest initialSymbol={chartSymbol} initialInterval={chartInterval} />
        </section>

        {/* LINHA 4: bot demo (forward-test) */}
        <section className="mb-6 sm:mb-8">
          <DemoBot />
        </section>
      </main>
    </div>
  );
}
