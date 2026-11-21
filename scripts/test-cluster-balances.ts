const addrs = [
  'sovra12a806ca82d506a025d580d40600abc77a69e10e7',
  'sovra1664a83c922035ce28bb723e4e92aed1e60e26ea1',
  'sovra1cb55be9a3d2afab1c9bcbffb88367bec797d11cb',
  'sovra1d96f6140a4c4ae797d9e3a5badf467eb756d3d20'
];

async function main() {
  const results = [];
  for (const a of addrs) {
    const b0 = (await (await fetch('http://127.0.0.1:26657/query/balance?address=' + a)).json()).balance;
    const b1 = (await (await fetch('http://127.0.0.1:26667/query/balance?address=' + a)).json()).balance;
    const b2 = (await (await fetch('http://127.0.0.1:26677/query/balance?address=' + a)).json()).balance;
    const b3 = (await (await fetch('http://127.0.0.1:26687/query/balance?address=' + a)).json()).balance;
    results.push({ address: a.slice(0, 16) + '...', node0: b0, node1: b1, node2: b2, node3: b3 });
  }
  console.table(results);
}
main().catch(console.error);
