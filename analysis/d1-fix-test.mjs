/** I due candidati per il pronome ristretto, misurati prima di scriverli. */
const RAW=/\b(qualcosa|qualcuno|roba|cose|varie|un\s+po'?|something|anything|stuff|some\s+things?)\b/i;
// A: il pronome seguito da una relativa restrittiva con dentro una parola piena
const RESTRICTED=/\b(qualcosa|qualcuno|something|anything|someone|somebody)\s+(?:che|per|who|that|which)\s+\w{3,}/i;
const T=[
 ["per qualcuno che ama la fotografia analogica",false],
 ["Scrivimi qualcosa.",true],
 ["Fai una cosa bella.",false],  // presa dalla riga bello/utile, non da questa
 ["Dammi qualcosa di utile",true],
 ["scrivi qualcosa per il blog aziendale",false],
 ["mandami qualcosa che funzioni",false],
 ["scrivi qualcosa che spieghi la ricorsione a un principiante",false],
 ["Regala qualcosa a qualcuno",true],
 ["un regalo per qualcuno che ama i libri",false],
 ["dimmi qualcosa",true],
 ["write something for someone who codes in Rust",false],
 ["write something",true],
];
console.log('testo                                                    grezzo  ristretto  atteso');
for(const [t,vago] of T){
  const raw=RAW.test(t), res=RESTRICTED.test(t);
  const finale = raw && !res;
  const ok = finale===vago ? 'ok' : '✗ SBAGLIATO';
  console.log(`${t.slice(0,54).padEnd(56)} ${String(raw).padEnd(7)} ${String(res).padEnd(10)} ${String(vago).padEnd(6)} ${ok}`);
}
