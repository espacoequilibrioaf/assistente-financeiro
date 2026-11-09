// Cotações compartilhadas pelo app e pelo conversor offline.
// Ficam guardadas no aparelho (localStorage) para funcionar sem internet.
export const MOEDAS_CONV = ['THB', 'INR', 'USD', 'EUR'];
const CHAVE = 'cotacoes.v1';

export function lerCotacoesSalvas() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || {}; } catch { return {}; }
}
function gravar(obj) { try { localStorage.setItem(CHAVE, JSON.stringify(obj)); } catch { /* sem armazenamento */ } }

// Cotação manual (casa de câmbio) tem prioridade sobre a oficial. valor = R$ por 1 unidade.
export function salvarManual(moeda, valor) {
  const s = lerCotacoesSalvas();
  if (valor) s[`${moeda}:manual`] = { valor, manual: true, salvaEm: new Date().toISOString() };
  else delete s[`${moeda}:manual`];
  gravar(s);
}

export function cotacaoDe(moeda, { aceitarManual = true } = {}) {
  if (moeda === 'BRL') return { valor: 1, data: new Date().toISOString().slice(0, 10) };
  const s = lerCotacoesSalvas();
  return (aceitarManual && s[`${moeda}:manual`]) || s[moeda] || null;
}

let emAndamento = null;
export function atualizarCotacoes(moedas = MOEDAS_CONV) {
  if (emAndamento) return emAndamento;
  const lista = [...new Set(moedas.filter((m) => m !== 'BRL'))].join(',');
  const urls = [
    `https://api.frankfurter.dev/v1/latest?base=BRL&symbols=${lista}`,
    `https://api.frankfurter.app/latest?from=BRL&to=${lista}`,
  ];
  emAndamento = (async () => {
    for (const url of urls) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const j = await r.json();
        if (!j.rates) continue;
        const s = lerCotacoesSalvas(); const agora = new Date().toISOString();
        for (const [m, taxa] of Object.entries(j.rates)) if (taxa > 0) s[m] = { valor: 1 / taxa, data: j.date, salvaEm: agora };
        gravar(s); return true;
      } catch { /* tenta a próxima */ }
    }
    return false;
  })().finally(() => { emAndamento = null; });
  return emAndamento;
}
