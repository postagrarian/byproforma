Fetch and analyze the BHB attribution report for the byproforma live portfolio.

API base: https://byproforma-production.up.railway.app

If $ARGUMENTS is provided, use it as the trade date (YYYY-MM-DD). Otherwise default to today's date in ET.

Steps:
1. Determine the date to use.
2. Run: `curl -s https://byproforma-production.up.railway.app/public/performance/{date}/attribution`
3. If the response contains a 404 or no data, say so clearly.
4. Otherwise, analyze the JSON and produce a structured report:

   **Header:** Portfolio return vs VOO, active return in bps, one-line verdict (outperformed / underperformed).

   **Top contributors and detractors:** List the 3 biggest positive and 3 biggest negative sectors by total_bps. For each, note: sector name, active weight (over/underweight), what drove it (allocation vs selection vs interaction), and the bps figure.

   **Selection standouts:** Any sector where |selection_bps| > 5 bps — flag as a stock-picking signal.

   **Residual:** Note the gap between active_return_bps and explained_bps and briefly explain it (SPDR proxy mismatch).

   Keep the tone factual and concise — this is a daily investment brief, not a narrative essay.
