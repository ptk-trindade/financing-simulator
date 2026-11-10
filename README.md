# Na Planta Flip Calculator

Should you buy an off-plan apartment in São Paulo (imóvel na planta) and resell it when you get the keys, or keep the same money in fixed income? This calculator answers that month by month.

**Live page:** https://ptk-trindade.github.io/financing-simulator/

It runs entirely in the browser. There is no back end and nothing to install. The interface is available in English and Portuguese.

## What it compares

- **Scenario A, buy and flip:** every out-of-pocket payment (sinal, developer installments, interest during construction, ITBI, registry, fees, condo and IPTU after the keys) against what you keep from the sale after the bank payoff, broker commission and capital-gains tax.
- **Scenario B, fixed income:** the same payments, on the same dates, invested at a fixed-income rate net of the regressive income tax.

The headline is the difference between the two. The page also shows:

- the **break-even resale price**, where both scenarios end up equal
- the annual return (IRR) of each scenario
- a cumulative chart and a month-by-month table
- a sensitivity chart and grid showing which inputs move the result most
- warnings for things to check, such as LTV caps, MCMV limits and installments that run past the sale

It covers the associativo and repasse structures, SBPE and MCMV credit lines, SAC and PRICE amortization, and selling either by deed or by cessão de direitos.

## Run it

Open `index.html` in a browser. That's all.

To change the code you need Node.js:

```sh
npm run build   # rebuilds index.html and simulator/na-planta-flip.html from the sources
npm test        # runs the reference test cases against the calculation engine
```

## Files

- `simulator/engine.js` holds all the calculations, with no DOM code. It runs in the browser and in Node.
- `simulator/app.html` is the page template: inputs, charts, tables and the English/Portuguese text.
- `simulator/build.mjs` inlines the engine into the template and writes the finished pages.
- `simulator/test.mjs` runs the two reference cases and extra checks.
- `index.html` is the built page that GitHub Pages serves. Don't edit it by hand; run `npm run build`.
- `simulator/na-planta-flip.html` is the same page without the document wrapper, for hosting as a Claude artifact.

## Things to confirm before relying on it

The model makes assumptions that vary by contract, bank and personal situation. Check these before deciding:

- **Developer:** whether a cessão de direitos is allowed and what it costs, how unpaid installments are corrected after the keys, and whether the balance can be settled early without a penalty.
- **Caixa or your bank:** the real rate, the LTV cap for your line and amortization system, the appraisal value at the keys, the insurance (MIP/DFI) and admin fees, and how long the averbação takes.
- **Accountant:** the capital-gains calculation (cost basis, FR2 reduction, exemptions) and the income tax on the fixed-income alternative.

This is a simulation for planning, not financial or tax advice.
