async function main() {
  const ports = [26657, 26667, 26677, 26687];
  const results = [];
  for (const p of ports) {
    const d = await (await fetch('http://127.0.0.1:' + p + '/status')).json();
    results.push({ port: p, moniker: d.moniker, height: d.height, supply: d.total_supply, mint: d.lifetime_mint, burn: d.lifetime_burn });
  }
  console.table(results);
}
main().catch(console.error);
