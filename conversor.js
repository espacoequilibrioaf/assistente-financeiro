// Conversor que funciona sem internet. Não usa Supabase nem dados financeiros:
// só guarda no aparelho as cotações (públicas) baixadas por último.
import { MOEDAS_CONV, lerCotacoesSalvas, atualizarCotacoes, salvarManual, cotacaoDe } from '/cotacoes.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, casas = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const lerNumero = (t) => {
  let s = String(t).trim().replace(/[^\d.,]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s); return Number.isFinite(n) && n > 0 ? n : null;
};
const dataBR = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';

let paraReal = true;
const params = new URLSearchParams(location.search);
const ultima = (() => { try { return localStorage.getItem('conversor.moeda'); } catch { return null; } })();
for (const m of MOEDAS_CONV) $('moeda').append(new Option(m, m));
$('moeda').value = params.get('moeda') || ultima || 'THB';
if (params.get('voltar')) $('voltar').href = params.get('voltar');

function desenhar() {
  const m = $('moeda').value;
  try { localStorage.setItem('conversor.moeda', m); } catch { /* sem armazenamento */ }
  $('m2').textContent = m;
  $('sentido').textContent = paraReal ? `${m} → R$` : `R$ → ${m}`;
  $('valor').placeholder = paraReal ? `valor em ${m}` : 'valor em reais';
  const c = cotacaoDe(m);
  if (!c) {
    $('resultado').textContent = 'Sem cotação guardada';
    $('detalhe').textContent = 'Abra esta tela uma vez com internet, ou digite uma cotação em “Usar outra cotação”.';
    return;
  }
  const origem = c.manual ? `sua cotação (${dataBR(c.salvaEm)})` : `cotação de ${dataBR(c.data)}`;
  const v = lerNumero($('valor').value);
  if (!v) { $('resultado').textContent = '—'; $('detalhe').textContent = `1 ${m} = R$ ${fmt(c.valor, 4)} · ${origem}`; return; }
  if (paraReal) {
    const r = v * c.valor;
    $('resultado').textContent = `≈ R$ ${fmt(r)}`;
    $('detalhe').textContent = c.manual ? `Usando ${origem}.`
      : `No cartão de crédito brasileiro, com IOF de 3,5%: ≈ R$ ${fmt(r * 1.035)}. Usando ${origem}.`;
  } else {
    $('resultado').textContent = `≈ ${fmt(v / c.valor)} ${m}`;
    $('detalhe').textContent = `1 ${m} = R$ ${fmt(c.valor, 4)} · ${origem}`;
  }
}

function aviso() {
  const s = lerCotacoesSalvas();
  const datas = Object.values(s).filter((c) => !c.manual).map((c) => c.salvaEm).sort();
  $('aviso').textContent = navigator.onLine
    ? (datas.length ? `Cotações atualizadas em ${dataBR(datas.at(-1))}.` : 'Buscando cotações…')
    : `Sem internet agora${datas.length ? ` · usando cotações de ${dataBR(datas.at(-1))}` : ''}.`;
}

$('sentido').addEventListener('click', () => { paraReal = !paraReal; desenhar(); $('valor').focus(); });
$('valor').addEventListener('input', desenhar);
$('moeda').addEventListener('change', desenhar);
$('salvar').addEventListener('click', () => {
  const n = lerNumero($('manual').value); if (!n) { $('manual').focus(); return; }
  salvarManual($('moeda').value, n); $('manual').value = ''; desenhar();
});
$('limpar').addEventListener('click', () => { salvarManual($('moeda').value, null); desenhar(); });
addEventListener('online', async () => { await atualizarCotacoes(); aviso(); desenhar(); });
addEventListener('offline', aviso);

aviso(); desenhar(); $('valor').focus();
atualizarCotacoes().then(() => { aviso(); desenhar(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
