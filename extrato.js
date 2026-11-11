// Leitura de extrato bancário em OFX (o formato "Money/Quicken" que os bancos exportam)
// e comparação com o que já foi lançado. Tudo roda no aparelho: o arquivo não sai do celular.

// ---------- leitura do arquivo ----------
export function decodificarArquivo(buffer) {
  const bytes = new Uint8Array(buffer);
  const cabeca = new TextDecoder('latin1').decode(bytes.slice(0, 600));
  const ehUtf8 = /encoding="?utf-?8/i.test(cabeca) || /CHARSET:\s*UTF-?8/i.test(cabeca);
  if (!ehUtf8) return new TextDecoder('windows-1252').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

function campo(bloco, tag) {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
}

function lerValorOfx(t) {
  let s = String(t).trim().replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function lerData(t) {
  const m = String(t).match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function limparTexto(t) {
  return String(t).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

// Devolve { banco, conta, inicio, fim, movimentos: [{ chave, data, valor (centavos, negativo = saída), descricao }] }
export function lerOfx(texto) {
  if (!/<OFX>/i.test(texto)) throw new Error('Este arquivo não parece um extrato OFX. No banco, escolha salvar o extrato como OFX (ou "Money").');
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const vistos = {};
  const movimentos = [];
  for (const b of blocos) {
    const data = lerData(campo(b, 'DTPOSTED'));
    const valor = lerValorOfx(campo(b, 'TRNAMT'));
    if (!data || valor === null || valor === 0) continue;
    const descricao = limparTexto(campo(b, 'MEMO') || campo(b, 'NAME') || 'Movimento');
    const base = `ofx:${campo(b, 'FITID')}:${data}:${valor}`;
    vistos[base] = (vistos[base] || 0) + 1;
    movimentos.push({ chave: vistos[base] > 1 ? `${base}#${vistos[base]}` : base, data, valor, descricao });
  }
  if (!movimentos.length) throw new Error('Não encontrei movimentos neste arquivo. Confira o período escolhido no banco.');
  movimentos.sort((a, b) => a.data.localeCompare(b.data));
  const datas = movimentos.map((m) => m.data);
  return {
    banco: campo(texto, 'ORG') || campo(texto, 'BANKID'),
    conta: campo(texto, 'ACCTID'),
    inicio: lerData(campo(texto, 'DTSTART')) || datas[0],
    fim: lerData(campo(texto, 'DTEND')) || datas[datas.length - 1],
    movimentos,
  };
}

// ---------- comparação com os lançamentos ----------
const sinal = (l) => (l.tipo === 'despesa' || (l.tipo === 'transferencia' && l.transferencia_sentido === 'saida') ? -1 : 1);
const dias = (a, b) => Math.abs(Date.parse(`${a}T12:00:00`) - Date.parse(`${b}T12:00:00`)) / 864e5;

export function chaveDescricao(t) {
  return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\d+[/.-]\d+([/.-]\d+)?/g, ' ').replace(/[^A-Z ]/g, ' ')
    .split(/\s+/).filter((p) => p.length > 1).slice(0, 3).join(' ');
}
function palavras(t) { return new Set(chaveDescricao(t).split(' ').filter((p) => p.length >= 4)); }
function parecido(a, b) { const pa = palavras(a); for (const p of palavras(b)) if (pa.has(p)) return true; return false; }

// lancs: lançamentos não cancelados do espaço (com conta_id, impressao_digital etc.)
// Devolve { itens: [{ mov, situacao: 'ja_importado'|'bateu'|'previsao'|'novo', lanc }], semExtrato: [lanc] }
export function conferir(extrato, lancs, contaId) {
  const usados = new Set();
  const daConta = (l) => !l.conta_id || l.conta_id === contaId;
  const porChave = new Map(lancs.filter((l) => l.impressao_digital).map((l) => [l.impressao_digital, l]));
  const itens = extrato.movimentos.map((mov) => {
    const ja = porChave.get(mov.chave);
    if (ja) { usados.add(ja.id); return { mov, situacao: 'ja_importado', lanc: ja }; }
    const valor = Math.abs(mov.valor); const s = Math.sign(mov.valor);
    const candidatos = lancs.filter((l) => !usados.has(l.id) && daConta(l) && sinal(l) === s);
    const confirmado = candidatos
      .filter((l) => l.status === 'confirmado' && l.conta_id === contaId && l.valor_centavos === valor && dias(l.data, mov.data) <= 4)
      .sort((a, b) => dias(a.data, mov.data) - dias(b.data, mov.data))[0];
    if (confirmado) { usados.add(confirmado.id); return { mov, situacao: 'bateu', lanc: confirmado }; }
    const previsto = candidatos
      .filter((l) => l.status === 'previsto' && dias(l.data, mov.data) <= 10 && (l.valor_centavos === valor || parecido(l.descricao, mov.descricao)))
      .sort((a, b) => (a.valor_centavos === valor ? 0 : 1) - (b.valor_centavos === valor ? 0 : 1) || dias(a.data, mov.data) - dias(b.data, mov.data))[0];
    if (previsto) { usados.add(previsto.id); return { mov, situacao: 'previsao', lanc: previsto }; }
    return { mov, situacao: 'novo', lanc: null };
  });
  const semExtrato = lancs.filter((l) => !usados.has(l.id) && l.status === 'confirmado' && l.conta_id === contaId
    && l.data >= extrato.inicio && l.data <= extrato.fim && l.tipo !== 'transferencia');
  return { itens, semExtrato };
}

// ---------- contas fixas: o que se repete mês a mês ----------
// Devolve [{ chave, descricao, media (centavos), dia, meses, totalMeses }]
export function contasFixas(extrato) {
  const mesesExtrato = [...new Set(extrato.movimentos.map((m) => m.data.slice(0, 7)))];
  const grupos = {};
  for (const m of extrato.movimentos) {
    if (m.valor >= 0) continue;
    const chave = chaveDescricao(m.descricao);
    if (!chave) continue;
    const g = (grupos[chave] = grupos[chave] || { porMes: {}, dias: [], nomes: {} });
    const mes = m.data.slice(0, 7);
    g.porMes[mes] = (g.porMes[mes] || 0) + Math.abs(m.valor);
    g.dias.push(Number(m.data.slice(8, 10)));
    g.nomes[m.descricao] = (g.nomes[m.descricao] || 0) + 1;
  }
  return Object.entries(grupos)
    .map(([chave, g]) => {
      const valores = Object.values(g.porMes);
      const dd = g.dias.sort((a, b) => a - b);
      return {
        chave,
        descricao: Object.entries(g.nomes).sort((a, b) => b[1] - a[1])[0][0],
        media: Math.round(valores.reduce((a, b) => a + b, 0) / valores.length),
        dia: dd[Math.floor(dd.length / 2)],
        meses: valores.length,
        totalMeses: mesesExtrato.length,
      };
    })
    .filter((g) => g.meses >= 2)
    .sort((a, b) => b.meses - a.meses || b.media - a.media);
}
