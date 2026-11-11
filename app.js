// Assistente Financeiro — app web sem etapa de build.
// Telas: login por código, início (espaços), espaço (resumo do mês, lançamentos, contas, membros).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { MOEDAS_CONV, atualizarCotacoes, cotacaoDe } from '/cotacoes.js';
import { decodificarArquivo, lerOfx, conferir, contasFixas, chaveDescricao } from '/extrato.js';
import { CONFIG } from './config.js';

const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const app = document.getElementById('app');
let promptInstalacao = null;
let usuario = null;          // { id, nome }
const estado = { mes: mesAtual() };

// ---------- utilitários ----------
function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) {
    if (f == null || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

function mostrar(...conteudo) {
  app.replaceChildren(...conteudo);
  window.scrollTo(0, 0);
}

function mensagemErro(erro) {
  const msg = (erro && (erro.message || String(erro))) || 'Erro desconhecido';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
  if (/expired|invalid.*(otp|token)/i.test(msg)) return 'Código inválido ou vencido. Peça um novo código.';
  if (/fetch|network/i.test(msg)) return 'Sem conexão com a internet. Tente de novo.';
  if (/row-level security/i.test(msg)) return 'Você não tem permissão para isso neste espaço.';
  return msg;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = (centavos) => brl.format((centavos || 0) / 100);
const numero = (v, casas = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });

function lerValor(texto) {
  // aceita "15", "15,50", "1.234,56", "15.5"
  let t = String(texto).trim().replace(/[^\d.,-]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function hojeISO() { return new Date().toLocaleDateString('sv-SE'); }
function mesAtual() { return hojeISO().slice(0, 7); }
function competencia(dataISO) { return `${dataISO.slice(0, 7)}-01`; }
function somarMes(mes, delta) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nomeMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const t = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function dataCurta(iso) { const [, m, d] = iso.split('-'); return `${d}/${m}`; }

const NOMES_TIPO = { pessoal: 'Pessoal', familia: 'Família', empresa: 'Empresa', viagem: 'Viagem' };
const NOMES_PAPEL = { dono: 'dono', editor: 'pode editar', leitor: 'só leitura', dependente: 'dependente' };
const NOMES_CONTA = { corrente: 'Conta corrente', poupanca: 'Poupança', dinheiro: 'Dinheiro', carteira_digital: 'Carteira digital', investimento: 'Investimento', outra: 'Outra' };

function marca() {
  return el('p', { class: 'marca' }, el('img', { class: 'boneco', src: '/icons/boneco.png', alt: '' }), 'Assistente Financeiro');
}

function telaErro(texto) {
  mostrar(el('section', { class: 'centro tela' },
    el('p', { class: 'erro' }, texto),
    el('button', { onclick: () => rotear() }, 'Tentar de novo'),
    el('button', { class: 'secundario', onclick: () => { location.hash = ''; } }, 'Voltar ao início'),
  ));
}

// ---------- login ----------
function telaEmail(erro = '') {
  const input = el('input', { type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', required: true, placeholder: 'voce@exemplo.com' });
  const botao = el('button', { type: 'submit' }, 'Enviar código');
  const form = el('form', { class: 'tela', onsubmit: async (e) => {
    e.preventDefault();
    const email = input.value.trim().toLowerCase();
    if (!email) return;
    botao.disabled = true; botao.textContent = 'Enviando…';
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } });
    if (error) return telaEmail(mensagemErro(error));
    telaCodigo(email);
  } },
    marca(),
    el('h1', {}, 'Entrar'),
    el('p', { class: 'discreto' }, 'Digite seu e-mail. Vamos mandar um código para você entrar, sem senha.'),
    el('label', {}, 'E-mail', input),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    botao,
  );
  mostrar(el('section', { class: 'centro tela' }, form));
  input.focus();
}

function telaCodigo(email, erro = '') {
  const input = el('input', { class: 'codigo', name: 'codigo', autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: '10', required: true, placeholder: '000000' });
  const botao = el('button', { type: 'submit' }, 'Entrar');
  const form = el('form', { class: 'tela', onsubmit: async (e) => {
    e.preventDefault();
    const token = input.value.replace(/\D/g, '');
    if (token.length < 6) return telaCodigo(email, 'O código tem pelo menos 6 números.');
    botao.disabled = true; botao.textContent = 'Conferindo…';
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) return telaCodigo(email, mensagemErro(error));
    rotear();
  } },
    el('h1', {}, 'Digite o código'),
    el('p', { class: 'discreto' }, `Enviamos um código para ${email}. Confira também a caixa de spam. Não precisa clicar no link do e-mail.`),
    el('label', {}, 'Código', input),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    botao,
    el('button', { type: 'button', class: 'link', onclick: () => telaEmail() }, 'Usar outro e-mail ou pedir novo código'),
  );
  mostrar(el('section', { class: 'centro tela' }, form));
  input.focus();
}

function telaNome(erro = '') {
  const input = el('input', { name: 'nome', autocomplete: 'given-name', required: true, maxlength: '60', placeholder: 'Seu nome' });
  const form = el('form', { class: 'tela', onsubmit: async (e) => {
    e.preventDefault();
    const nome = input.value.trim();
    if (!nome) return;
    const { error } = await supabase.from('perfis').update({ nome }).eq('id', usuario.id);
    if (error) return telaNome(mensagemErro(error));
    rotear();
  } },
    el('h1', {}, 'Como podemos te chamar?'),
    el('label', {}, 'Nome', input),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    el('button', { type: 'submit' }, 'Continuar'),
  );
  mostrar(el('section', { class: 'centro tela' }, form));
  input.focus();
}

// ---------- início ----------
async function telaInicio() {
  const { data: membros, error } = await supabase
    .from('membros_espaco').select('papel, espacos ( id, nome, tipo )').eq('usuario_id', usuario.id);
  if (error) return telaErro(`Não foi possível carregar seus espaços: ${mensagemErro(error)}`);
  const ordem = { pessoal: 0, familia: 1, empresa: 2, viagem: 3 };
  const espacos = membros.filter((m) => m.espacos).map((m) => ({ ...m.espacos, papel: m.papel }))
    .sort((a, b) => (ordem[a.tipo] - ordem[b.tipo]) || a.nome.localeCompare(b.nome, 'pt-BR'));

  const lista = el('ul', { class: 'lista' }, espacos.map((e) => el('li', {},
    el('a', { class: 'cartao clicavel', href: `#/espaco/${e.id}` },
      el('div', { class: 'linha' }, el('strong', {}, e.nome), el('span', { class: 'etiqueta' }, NOMES_TIPO[e.tipo] || e.tipo)),
      el('p', { class: 'discreto' }, `Você: ${NOMES_PAPEL[e.papel] || e.papel}`),
    ),
  )));

  // criar espaço de família ou empresa
  const nome = el('input', { name: 'nome', required: true, maxlength: '60', placeholder: 'Ex.: Família, doPontoAparaB, Espaço Equilíbrio' });
  const tipo = el('select', { name: 'tipo' }, el('option', { value: 'familia' }, 'Família'), el('option', { value: 'empresa' }, 'Empresa'), el('option', { value: 'viagem' }, 'Viagem (separada do dia a dia)'));
  const erroCriar = el('p', { class: 'erro', role: 'alert' });
  const formCriar = el('form', { class: 'cartao tela escondido', onsubmit: async (e) => {
    e.preventDefault();
    if (!nome.value.trim()) return;
    const { data, error: erro } = await supabase.from('espacos')
      .insert({ nome: nome.value.trim(), tipo: tipo.value, criado_por: usuario.id }).select('id').single();
    if (erro) { erroCriar.textContent = mensagemErro(erro); return; }
    if (tipo.value === 'viagem') {
      const { data: proj, error: e2 } = await supabase.from('projetos')
        .insert({ espaco_id: data.id, nome: nome.value.trim(), tipo: 'viagem', moedas: ['BRL', 'USD', 'EUR'] }).select('id').single();
      if (e2) { erroCriar.textContent = mensagemErro(e2); return; }
      await supabase.from('projeto_rubricas').insert(RUBRICAS_VIAGEM.map((n, i) => ({ espaco_id: data.id, projeto_id: proj.id, nome: n, ordem: i })));
      location.hash = `#/projeto/${proj.id}`; return;
    }
    location.hash = `#/espaco/${data.id}`;
  } },
    el('strong', {}, 'Novo espaço'),
    el('label', {}, 'Nome', nome),
    el('label', {}, 'Tipo', tipo),
    erroCriar,
    el('button', { type: 'submit' }, 'Criar espaço'),
  );

  const instalar = promptInstalacao && el('button', { class: 'secundario', onclick: async () => {
    promptInstalacao.prompt(); await promptInstalacao.userChoice; promptInstalacao = null; rotear();
  } }, 'Instalar o app no celular');
  const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;

  mostrar(el('section', { class: 'tela' },
    marca(),
    el('h1', {}, `Olá, ${usuario.nome}!`),
    el('h2', {}, 'Seus espaços'),
    lista,
    el('button', { class: 'secundario', onclick: () => { formCriar.classList.toggle('escondido'); nome.focus(); } }, '+ Criar espaço de família ou empresa'),
    formCriar,
    instalar,
    ehIOS && el('p', { class: 'discreto' }, 'No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.'),
    el('button', { class: 'link', onclick: async () => { await supabase.auth.signOut(); } }, 'Sair'),
  ));
}

// ---------- espaço ----------
async function carregarCategorias(espacoId) {
  const { data, error } = await supabase.from('categorias')
    .select('id, nome, tipo, pai_id, ordem, espaco_id').eq('ativa', true)
    .or(`espaco_id.is.null,espaco_id.eq.${espacoId}`);
  if (error) throw error;
  const lista = [];
  // primeiro as criadas por vocês neste espaço, depois as padrão
  data.filter((c) => c.espaco_id && !c.pai_id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .forEach((c) => lista.push({ id: c.id, tipo: c.tipo, rotulo: c.nome }));
  const pais = data.filter((c) => !c.espaco_id && !c.pai_id).sort((a, b) => a.ordem - b.ordem);
  for (const p of pais) {
    lista.push({ id: p.id, tipo: p.tipo, rotulo: p.nome });
    data.filter((c) => c.pai_id === p.id).sort((a, b) => a.ordem - b.ordem)
      .forEach((f) => lista.push({ id: f.id, tipo: f.tipo, rotulo: `${p.nome} › ${f.nome}` }));
  }
  return lista;
}

async function telaEspaco(espacoId) {
  const { data: viagem } = await supabase.from('espacos').select('tipo, projetos ( id )').eq('id', espacoId).single();
  if (viagem && viagem.tipo === 'viagem' && viagem.projetos && viagem.projetos.length) {
    history.replaceState(null, '', `#/projeto/${viagem.projetos[0].id}`);
    return telaProjeto(viagem.projetos[0].id);
  }
  const mes = estado.mes;
  const [espR, papelR, contasR, mesR, saldosR, membrosR, projR, anoR] = await Promise.all([
    supabase.from('espacos').select('id, nome, tipo').eq('id', espacoId).single(),
    supabase.from('membros_espaco').select('papel').eq('espaco_id', espacoId).eq('usuario_id', usuario.id).single(),
    supabase.from('contas').select('id, nome, tipo, saldo_inicial_centavos').eq('espaco_id', espacoId).eq('ativa', true).order('nome'),
    supabase.from('lancamentos')
      .select('id, tipo, status, descricao, observacao, valor_centavos, valor_previsto_centavos, data, categoria_id, conta_id, moeda, valor_original, cotacao, projeto_id, pago_por, transferencia_sentido, transferencia_par_id, situacao')
      .eq('espaco_id', espacoId).eq('data_competencia', `${mes}-01`).neq('status', 'cancelado')
      .order('data', { ascending: false }).order('criado_em', { ascending: false }),
    supabase.from('lancamentos').select('conta_id, tipo, valor_centavos, transferencia_sentido').eq('espaco_id', espacoId).eq('status', 'confirmado'),
    supabase.from('membros_espaco').select('papel, usuario_id, perfis ( nome )').eq('espaco_id', espacoId),
    supabase.from('projetos').select('id, nome, tipo, data_inicio, data_fim, projeto_rubricas ( valor_previsto_centavos ), lancamentos ( tipo, status, valor_centavos )')
      .eq('espaco_id', espacoId).eq('ativo', true).order('criado_em', { ascending: false }),
    supabase.from('lancamentos').select('tipo, status, descricao, valor_centavos, data, data_competencia')
      .eq('espaco_id', espacoId).neq('status', 'cancelado').in('tipo', ['receita', 'despesa'])
      .gte('data_competencia', `${mesAtual()}-01`).lte('data_competencia', `${somarMes(mesAtual(), 11)}-01`),
  ]);
  const erro = [espR, papelR, contasR, mesR, saldosR, membrosR, projR, anoR].find((r) => r.error);
  if (erro) return telaErro(`Não foi possível abrir este espaço: ${mensagemErro(erro.error)}`);
  let cats;
  try { cats = await carregarCategorias(espacoId); } catch (e) { return telaErro(mensagemErro(e)); }

  const espaco = espR.data; const papel = papelR.data.papel;
  const podeEditar = papel === 'dono' || papel === 'editor';
  const ehDependente = papel === 'dependente';
  const contas = contasR.data; const lancs = mesR.data;
  const nomeCat = Object.fromEntries(cats.map((c) => [c.id, c.rotulo]));
  const nomeConta = Object.fromEntries(contas.map((c) => [c.id, c.nome]));

  // resumo do mês
  const soma = (filtro, campo = 'valor_centavos') => lancs.filter(filtro).reduce((s, l) => s + (l[campo] || 0), 0);
  const realRec = soma((l) => l.status === 'confirmado' && l.tipo === 'receita');
  const realDesp = soma((l) => l.status === 'confirmado' && l.tipo === 'despesa');
  const prevRec = soma((l) => l.valor_previsto_centavos && l.tipo === 'receita', 'valor_previsto_centavos');
  const prevDesp = soma((l) => l.valor_previsto_centavos && l.tipo === 'despesa', 'valor_previsto_centavos');
  const aPagar = soma((l) => l.status === 'previsto' && l.tipo === 'despesa');
  const aReceber = soma((l) => l.status === 'previsto' && l.tipo === 'receita');

  // saldos das contas (saldo inicial + receitas − despesas confirmadas)
  let movs, editaveis;
  try { [movs, editaveis] = await Promise.all([movimentosDasContas(contas.map((c) => c.id)), contasEditaveis()]); }
  catch (e) { return telaErro(mensagemErro(e)); }
  const saldo = calcularSaldos(contas, movs);
  const saldoTotal = Object.values(saldo).reduce((a, b) => a + b, 0);

  const recarregar = () => telaEspaco(espacoId);
  const painel = montarPainel({ saldoTotal, lancs, anoLancs: anoR.data, cats, mes });
  const valorLinha = (rot, v, classe = '') => el('div', { class: 'linha' }, el('span', { class: 'discreto' }, rot), el('strong', { class: classe }, reais(v)));

  const cabecalho = el('div', { class: 'tela' },
    el('a', { class: 'link', href: '#/' }, '‹ Seus espaços'),
    el('div', { class: 'linha' }, el('h1', {}, espaco.nome), el('span', { class: 'etiqueta' }, NOMES_TIPO[espaco.tipo])),
  );

  const navMes = el('div', { class: 'linha mes' },
    el('button', { class: 'secundario pequeno', 'aria-label': 'Mês anterior', onclick: () => { estado.mes = somarMes(mes, -1); recarregar(); } }, '‹'),
    el('strong', {}, nomeMes(mes)),
    el('button', { class: 'secundario pequeno', 'aria-label': 'Próximo mês', onclick: () => { estado.mes = somarMes(mes, 1); recarregar(); } }, '›'),
  );

  const resumo = el('div', { class: 'grade2' },
    el('div', { class: 'cartao' },
      el('strong', {}, 'Realizado'),
      valorLinha('Receitas', realRec, 'positivo'),
      valorLinha('Despesas', realDesp, 'negativo'),
      valorLinha('Saldo do mês', realRec - realDesp),
    ),
    el('div', { class: 'cartao' },
      el('strong', {}, 'Previsto'),
      valorLinha('Receitas', prevRec, 'positivo'),
      valorLinha('Despesas', prevDesp, 'negativo'),
      valorLinha('Saldo previsto', prevRec - prevDesp),
    ),
  );
  const pendencias = (aPagar || aReceber) && el('p', { class: 'aviso' },
    `Ainda a pagar neste mês: ${reais(aPagar)}` + (aReceber ? ` · a receber: ${reais(aReceber)}` : ''));

  // formulário de lançamento
  const formLanc = formularioLancamento({ espacoId, contas, cats, podeEditar, ehDependente, aoSalvar: recarregar });

  // lista de lançamentos
  const lista = lancs.length
    ? el('ul', { class: 'lista' }, lancs.map((l) => itemLancamento(l, { nomeCat, nomeConta, contas, podeEditar, aoMudar: recarregar })))
    : el('p', { class: 'discreto' }, 'Nenhum lançamento neste mês ainda.');

  // contas
  const blocoContas = el('div', { class: 'tela' },
    el('div', { class: 'linha' }, el('h2', {}, 'Contas'), el('strong', {}, reais(saldoTotal))),
    contas.length
      ? el('ul', { class: 'lista' }, contas.map((c) => el('li', { class: 'cartao' },
          el('div', { class: 'linha' }, el('strong', {}, c.nome), el('strong', {}, reais(saldo[c.id]))),
          el('div', { class: 'linha' },
            el('span', { class: 'discreto' }, NOMES_CONTA[c.tipo] || c.tipo),
            podeEditar && el('button', { class: 'link pequeno', onclick: async () => {
              const atual = (saldo[c.id] / 100).toFixed(2).replace('.', ',');
              const texto = prompt(`Qual é o saldo real de "${c.nome}" hoje? (agora o app mostra ${reais(saldo[c.id])})`, atual);
              if (texto == null) return;
              const neg = texto.trim().startsWith('-');
              const novo = texto.trim().replace('-', '') === '0' ? 0 : lerValor(texto.replace('-', ''));
              if (novo === null) { alert('Valor inválido.'); return; }
              const desejado = neg ? -novo : novo;
              const { error } = await supabase.from('contas')
                .update({ saldo_inicial_centavos: c.saldo_inicial_centavos + (desejado - saldo[c.id]) }).eq('id', c.id);
              if (error) { alert(mensagemErro(error)); return; }
              recarregar();
            } }, 'Ajustar saldo'),
          ))))
      : el('p', { class: 'discreto' }, 'Cadastre a primeira conta (banco, dinheiro ou carteira digital) com o saldo de hoje. O saldo inicial fica na conta, e não como receita, para não inflar as receitas do mês.'),
    podeEditar && formularioConta(espacoId, recarregar),
    podeEditar && editaveis.length >= 2 && formularioTransferencia(editaveis, recarregar, espacoId),
    el('p', { class: 'discreto' }, 'Cartões de crédito, faturas e parcelas chegam na próxima etapa.'),
  );

  // membros (família / empresa)
  const blocoMembros = espaco.tipo !== 'pessoal' && el('div', { class: 'tela' },
    el('h2', {}, 'Quem participa'),
    el('ul', { class: 'lista' }, membrosR.data.map((m) => el('li', { class: 'cartao linha' },
      el('span', {}, (m.perfis && m.perfis.nome) || 'Sem nome'), el('span', { class: 'etiqueta' }, NOMES_PAPEL[m.papel] || m.papel)))),
    papel === 'dono' && formularioConvite(espacoId, recarregar),
  );

  mostrar(el('section', { class: 'tela' },
    marca(), cabecalho, painel.topo, navMes, resumo, pendencias, painel.categorias,
    (podeEditar || ehDependente) && formLanc,
    podeEditar && contas.length ? el('a', { class: 'botao-extrato', href: `#/extrato/${espacoId}` }, '📄 Anexar extrato do banco') : null,
    el('h2', {}, 'Lançamentos do mês'), lista,
    painel.meses,
    blocoProjetos(espacoId, projR.data, podeEditar),
    blocoContas, blocoMembros,
  ));
}

// ---------- extrato do banco (OFX): conferência e contas fixas ----------
async function telaExtrato(espacoId) {
  const [espR, contasR] = await Promise.all([
    supabase.from('espacos').select('id, nome').eq('id', espacoId).single(),
    supabase.from('contas').select('id, nome, criado_em').eq('espaco_id', espacoId).eq('ativa', true).order('nome'),
  ]);
  if (espR.error || contasR.error) return telaErro(mensagemErro(espR.error || contasR.error));
  let cats;
  try { cats = await carregarCategorias(espacoId); } catch (e) { return telaErro(mensagemErro(e)); }
  const voltar = `#/espaco/${espacoId}`;
  const conta = el('select', {}, contasR.data.map((c) => el('option', { value: c.id }, c.nome)));
  const arquivo = el('input', { type: 'file', class: 'arquivo' });
  const erro = el('p', { class: 'erro', role: 'alert' });
  const resultado = el('div', { class: 'tela' });

  arquivo.addEventListener('change', async () => {
    erro.textContent = ''; resultado.replaceChildren();
    const f = arquivo.files[0]; if (!f) return;
    let extrato;
    try { extrato = lerOfx(decodificarArquivo(await f.arrayBuffer())); } catch (e) { erro.textContent = e.message; return; }
    resultado.replaceChildren(el('p', { class: 'discreto' }, 'Comparando com o que já foi lançado…'));
    const ini = new Date(Date.parse(`${extrato.inicio}T12:00:00`) - 15 * 864e5).toISOString().slice(0, 10);
    const fimMais = new Date(Date.parse(`${extrato.fim}T12:00:00`) + 15 * 864e5).toISOString().slice(0, 10);
    const campos = 'id, tipo, status, descricao, valor_centavos, valor_previsto_centavos, data, conta_id, impressao_digital, transferencia_sentido';
    const [lR, fR] = await Promise.all([
      supabase.from('lancamentos').select(campos).eq('espaco_id', espacoId).neq('status', 'cancelado').gte('data', ini).lte('data', fimMais),
      supabase.from('lancamentos').select('descricao').eq('espaco_id', espacoId).eq('status', 'previsto').gte('data', hojeISO()),
    ]);
    if (lR.error || fR.error) { resultado.replaceChildren(); erro.textContent = mensagemErro(lR.error || fR.error); return; }
    montarConferencia(extrato, conferir(extrato, lR.data, conta.value), contasFixas(extrato),
      new Set(fR.data.map((l) => chaveDescricao(l.descricao))));
  });

  function montarConferencia(extrato, { itens, semExtrato }, fixas, jaPrevistas) {
    const por = (sit) => itens.filter((i) => i.situacao === sit);
    const previsoes = por('previsao'); const novos = por('novo');
    const batidos = [...por('bateu'), ...por('ja_importado')];
    const opcoesCat = (tipo) => [el('option', { value: '' }, 'Sem categoria'), ...cats.filter((c) => c.tipo === tipo).map((c) => el('option', { value: c.id }, c.rotulo))];
    const sinalValor = (v) => el('strong', { class: v < 0 ? 'negativo' : 'positivo' }, reais(Math.abs(v)));

    const marcPrev = previsoes.map((i) => ({ i, cb: el('input', { type: 'checkbox', checked: true }) }));
    // movimentos de antes da conta existir no app já estão no saldo inicial: vêm desmarcados
    const inicioConta = (contasR.data.find((c) => c.id === conta.value)?.criado_em || '').slice(0, 10);
    const antigo = (i) => inicioConta && i.mov.data < inicioConta;
    const marcNovo = novos.map((i) => ({ i, antigo: antigo(i), cb: el('input', { type: 'checkbox', checked: !antigo(i) }),
      cat: el('select', { 'aria-label': 'Categoria' }, opcoesCat(i.mov.valor < 0 ? 'despesa' : 'receita')) }));
    const marcFixa = fixas.map((f) => {
      const existe = jaPrevistas.has(f.chave);
      return { f, existe, cb: el('input', { type: 'checkbox', checked: !existe }),
        nome: el('input', { value: f.descricao, maxlength: '120', 'aria-label': 'Descrição' }),
        valor: el('input', { value: numero(f.media / 100), inputmode: 'decimal', 'aria-label': 'Valor por mês' }),
        dia: el('input', { value: String(f.dia), inputmode: 'numeric', maxlength: '2', 'aria-label': 'Dia do vencimento' }) };
    });
    const proximo = somarMes(mesAtual(), 1);
    const desde = el('select', { 'aria-label': 'A partir de' }, [mesAtual(), proximo, somarMes(proximo, 1)].map((m) => el('option', { value: m, selected: m === proximo }, nomeMes(m))));
    const quantos = el('select', { 'aria-label': 'Por quantos meses' }, [3, 6, 12, 14].map((n) => el('option', { value: n, selected: n === 12 }, `${n} meses`)));
    const botao = el('button', {}, 'Salvar o que está marcado');
    const erroS = el('p', { class: 'erro', role: 'alert' });

    botao.addEventListener('click', async () => {
      erroS.textContent = ''; botao.disabled = true; botao.textContent = 'Salvando…';
      const contaId = conta.value; let feitos = 0;
      try {
        // 1) previsões que aconteceram: viram realizado com o valor do extrato
        for (const { i, cb } of marcPrev) {
          if (!cb.checked) continue;
          const { error } = await supabase.from('lancamentos').update({ status: 'confirmado', valor_centavos: Math.abs(i.mov.valor), data: i.mov.data, conta_id: contaId, impressao_digital: i.mov.chave }).eq('id', i.lanc.id);
          if (error) throw error; feitos++;
        }
        // 2) o que já batia ganha a "identidade" do extrato, para não ser conferido de novo
        for (const i of batidos) if (i.situacao === 'bateu') {
          await supabase.from('lancamentos').update({ impressao_digital: i.mov.chave }).eq('id', i.lanc.id);
        }
        // 3) movimentos que faltavam
        const novosSel = marcNovo.filter((m) => m.cb.checked).map(({ i, cat }) => ({
          espaco_id: espacoId, tipo: i.mov.valor < 0 ? 'despesa' : 'receita', status: 'confirmado', descricao: i.mov.descricao,
          valor_centavos: Math.abs(i.mov.valor), data: i.mov.data, data_competencia: competencia(i.mov.data),
          categoria_id: cat.value || null, conta_id: contaId, origem: 'importacao', impressao_digital: i.mov.chave,
        }));
        if (novosSel.length) { const { error } = await supabase.from('lancamentos').insert(novosSel); if (error) throw error; feitos += novosSel.length; }
        // 4) contas fixas viram previsões dos próximos meses
        const prevs = [];
        for (const m of marcFixa) {
          if (!m.cb.checked) continue;
          const v = lerValor(m.valor.value); const d = Math.min(28, Math.max(1, Number(m.dia.value) || 10));
          if (!v) throw new Error(`Confira o valor de “${m.nome.value}”.`);
          for (let k = 0; k < Number(quantos.value); k++) {
            const mes = somarMes(desde.value, k);
            const dataM = `${mes}-${String(d).padStart(2, '0')}`;
            prevs.push({ espaco_id: espacoId, tipo: 'despesa', status: 'previsto', descricao: m.nome.value.trim() || m.f.descricao,
              valor_centavos: v, valor_previsto_centavos: v, data: dataM, data_competencia: `${mes}-01`, conta_id: contaId, origem: 'importacao' });
          }
        }
        if (prevs.length) { const { error } = await supabase.from('lancamentos').insert(prevs); if (error) throw error; feitos += prevs.length; }
      } catch (e) {
        botao.disabled = false; botao.textContent = 'Tentar salvar de novo';
        erroS.textContent = `${mensagemErro(e)}${feitos ? ` (${feitos} itens já foram salvos antes do erro; ao tentar de novo, anexe o extrato outra vez para conferir.)` : ''}`;
        return;
      }
      resultado.replaceChildren(el('div', { class: 'cartao tela' },
        el('strong', {}, '✓ Pronto!'),
        el('p', {}, `${feitos} ${feitos === 1 ? 'item salvo' : 'itens salvos'}. Se anexar este extrato de novo, nada entra em dobro.`),
        el('a', { class: 'botao-extrato', href: voltar }, 'Ver o espaço')));
    });

    const secao = (titulo, explicacao, filhos) => filhos.length ? el('div', { class: 'tela' }, el('h2', {}, titulo), el('p', { class: 'discreto pequeno-texto' }, explicacao), el('ul', { class: 'lista' }, filhos)) : null;
    resultado.replaceChildren(...[
      el('p', { class: 'aviso' }, `Extrato de ${dataCurta(extrato.inicio)} a ${dataCurta(extrato.fim)}: ${extrato.movimentos.length} movimentos. `
        + `${batidos.length} já conferem, ${previsoes.length} previsões aconteceram, ${novos.length} não estavam lançados.`),
      secao('Previsões que aconteceram', 'Marcadas viram “realizado” com o valor real do extrato.', marcPrev.map(({ i, cb }) => el('li', { class: 'cartao' },
        el('label', { class: 'marcar' }, cb, el('span', { class: 'item-nome' }, `${i.lanc.descricao || 'Previsão'} · ${dataCurta(i.mov.data)}`)),
        el('div', { class: 'linha pequeno-texto' }, el('span', { class: 'discreto' }, `previsto ${reais(i.lanc.valor_centavos)} → real`), sinalValor(i.mov.valor)),
        el('p', { class: 'discreto pequeno-texto' }, `No extrato: ${i.mov.descricao}`)))),
      secao('No extrato, mas não lançados', `Marcados entram como realizados nesta conta. A categoria é opcional.${marcNovo.some((m) => m.antigo) ? ` Os de antes de ${dataCurta(inicioConta)} vêm desmarcados: o saldo inicial da conta já inclui esses gastos, e lançá-los mudaria o saldo.` : ''}`, [
        marcNovo.length > 3 ? el('li', { class: 'linha' }, el('button', { type: 'button', class: 'secundario pequeno', onclick: () => marcNovo.forEach((m) => { m.cb.checked = true; }) }, 'Marcar todos'),
          el('button', { type: 'button', class: 'secundario pequeno', onclick: () => marcNovo.forEach((m) => { m.cb.checked = false; }) }, 'Desmarcar todos')) : null,
        ...marcNovo.map(({ i, cb, cat, antigo: velho }) => el('li', { class: `cartao ${velho ? 'passado' : ''}` },
        el('div', { class: 'linha' }, el('label', { class: 'marcar' }, cb, el('span', { class: 'item-nome' }, i.mov.descricao)), sinalValor(i.mov.valor)),
        el('div', { class: 'linha pequeno-texto' }, el('span', { class: 'discreto' }, dataCurta(i.mov.data)), cat)))].filter(Boolean)),
      semExtrato.length ? el('div', { class: 'tela' }, el('h2', {}, 'Lançados como pagos, mas fora do extrato'),
        el('p', { class: 'discreto pequeno-texto' }, 'Vale conferir: talvez tenham sido pagos por outra conta, ou com outro valor.'),
        el('ul', { class: 'lista' }, semExtrato.map((l) => el('li', { class: 'cartao linha' }, el('span', {}, `${dataCurta(l.data)} · ${l.descricao || 'Sem descrição'}`), el('strong', {}, reais(l.valor_centavos)))))) : null,
      batidos.length ? el('details', { class: 'cartao' }, el('summary', {}, `✓ ${batidos.length} movimentos já estavam certinhos`),
        el('ul', { class: 'lista' }, batidos.map((i) => el('li', { class: 'linha pequeno-texto' }, el('span', {}, `${dataCurta(i.mov.data)} · ${i.mov.descricao}`), sinalValor(i.mov.valor))))) : null,
      marcFixa.length ? el('div', { class: 'tela' }, el('h2', {}, 'Contas fixas → previsões'),
        el('p', { class: 'discreto pequeno-texto' }, 'Gastos que se repetiram em mais de um mês, com a média. Marque os que devem virar previsão; dá para ajustar nome, valor e dia.'),
        el('div', { class: 'grade2' }, el('label', {}, 'A partir de', desde), el('label', {}, 'Por', quantos)),
        el('ul', { class: 'lista' }, marcFixa.map((m) => el('li', { class: 'cartao tela' },
          el('label', { class: 'marcar' }, m.cb, el('span', { class: 'discreto pequeno-texto' }, `apareceu em ${m.f.meses} de ${m.f.totalMeses} meses${m.existe ? ' · já existe previsão parecida' : ''}`)),
          m.nome,
          el('div', { class: 'grade2' }, el('label', {}, 'Média por mês (R$)', m.valor), el('label', {}, 'Dia', m.dia)))))) : null,
      (marcPrev.length || marcNovo.length || marcFixa.length) ? el('div', { class: 'tela' }, erroS, botao)
        : el('p', { class: 'discreto' }, 'Nada para fazer: tudo deste extrato já está lançado.'),
    ].filter(Boolean));
  }

  mostrar(el('section', { class: 'tela' },
    marca(),
    el('a', { class: 'link', href: voltar }, `‹ ${espR.data.nome}`),
    el('h1', {}, 'Anexar extrato'),
    el('p', { class: 'discreto' }, 'O app compara o extrato com o que já foi lançado e encontra as contas que se repetem. Nada é salvo antes de você conferir.'),
    el('details', { class: 'cartao' }, el('summary', {}, 'Como baixar o extrato do Itaú'),
      el('ol', { class: 'pequeno-texto' },
        el('li', {}, 'No computador, entre no site do Itaú (itau.com.br) com sua conta.'),
        el('li', {}, 'Vá em Conta corrente › Extrato e escolha o período (os últimos 3 meses são o ideal).'),
        el('li', {}, 'Procure “Salvar em outros formatos” e escolha OFX (ou “Money”).'),
        el('li', {}, 'Mande o arquivo para o celular (por e-mail ou WhatsApp) e anexe aqui, ou anexe direto pelo computador.'))),
    el('div', { class: 'cartao tela' },
      el('label', {}, 'Conta deste extrato', conta),
      el('label', {}, 'Arquivo do extrato (.ofx)', arquivo),
      erro),
    resultado,
  ));
}

async function contasEditaveis() {
  const { data, error } = await supabase.from('membros_espaco')
    .select('papel, espacos ( id, nome, contas ( id, nome, tipo, saldo_inicial_centavos, ativa ) )')
    .eq('usuario_id', usuario.id).in('papel', ['dono', 'editor']);
  if (error) throw error;
  return data.flatMap((m) => (m.espacos?.contas || []).filter((c) => c.ativa)
    .map((c) => ({ ...c, espaco_id: m.espacos.id, espaco_nome: m.espacos.nome })));
}

async function movimentosDasContas(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('lancamentos').select('conta_id, tipo, valor_centavos, transferencia_sentido')
    .in('conta_id', ids).eq('status', 'confirmado');
  if (error) throw error;
  return data;
}

function calcularSaldos(contas, movimentos) {
  const saldo = Object.fromEntries(contas.map((c) => [c.id, c.saldo_inicial_centavos]));
  for (const l of movimentos) {
    if (!(l.conta_id in saldo)) continue;
    const entra = l.tipo === 'receita' || (l.tipo === 'transferencia' && l.transferencia_sentido === 'entrada');
    const sai = l.tipo === 'despesa' || (l.tipo === 'transferencia' && l.transferencia_sentido === 'saida');
    if (entra) saldo[l.conta_id] += l.valor_centavos;
    if (sai) saldo[l.conta_id] -= l.valor_centavos;
  }
  return saldo;
}

// ---------- painel ----------
function montarPainel({ saldoTotal, lancs, anoLancs, cats, mes }) {
  const hoje = hojeISO(); const mesHoje = mesAtual();
  const doMesHoje = anoLancs.filter((l) => l.data_competencia.startsWith(mesHoje));
  const sai = doMesHoje.filter((l) => l.status === 'previsto' && l.tipo === 'despesa').reduce((a, l) => a + l.valor_centavos, 0);
  const entra = doMesHoje.filter((l) => l.status === 'previsto' && l.tipo === 'receita').reduce((a, l) => a + l.valor_centavos, 0);
  const fimMes = saldoTotal - sai + entra;
  const nomeMesHoje = nomeMes(mesHoje).split(' ')[0].toLowerCase();

  const tile = (rotulo, valor, nota, classe = '') => el('div', { class: `cartao kpi ${classe}` },
    el('span', { class: 'discreto' }, rotulo), el('strong', { class: 'kpi-valor' }, reais(valor)), nota && el('span', { class: 'discreto pequeno-texto' }, nota));

  // próximos vencimentos (15 dias)
  const limite = new Date(); limite.setDate(limite.getDate() + 15);
  const limiteISO = limite.toLocaleDateString('sv-SE');
  const proximos = anoLancs.filter((l) => l.status === 'previsto' && l.tipo === 'despesa' && l.data >= hoje && l.data <= limiteISO)
    .sort((a, b) => a.data.localeCompare(b.data)).slice(0, 6);
  const atrasados = anoLancs.filter((l) => l.status === 'previsto' && l.tipo === 'despesa' && l.data < hoje);

  const topo = el('div', { class: 'tela' },
    el('div', { class: 'kpis' },
      tile('Saldo hoje', saldoTotal, 'somando as contas'),
      tile(`Ainda sai em ${nomeMesHoje}`, sai, entra ? `entra ${reais(entra)}` : 'contas previstas'),
      tile(`Fim de ${nomeMesHoje}`, fimMes, 'saldo previsto', fimMes < 0 ? 'alerta' : ''),
    ),
    atrasados.length ? el('p', { class: 'aviso' }, `${atrasados.length} previsão(ões) com data passada ainda sem valor real. Confirme ou cancele na lista do mês.`) : null,
    el('div', { class: 'cartao' },
      el('strong', {}, 'Próximos vencimentos (15 dias)'),
      proximos.length
        ? el('ul', { class: 'vencimentos' }, proximos.map((l) => el('li', { class: 'linha' },
            el('span', {}, `${dataCurta(l.data)} · ${l.descricao || 'Sem descrição'}`), el('strong', {}, reais(l.valor_centavos)))))
        : el('p', { class: 'discreto' }, 'Nada previsto para os próximos 15 dias.'),
    ),
  );

  // gastos do mês selecionado por categoria (categoria principal), pago × ainda previsto
  const principal = Object.fromEntries(cats.map((c) => [c.id, c.rotulo.split(' › ')[0]]));
  const grupos = {};
  for (const l of lancs.filter((x) => x.tipo === 'despesa')) {
    const g = principal[l.categoria_id] || 'Sem categoria';
    grupos[g] = grupos[g] || { pago: 0, previsto: 0 };
    if (l.status === 'confirmado') grupos[g].pago += l.valor_centavos; else grupos[g].previsto += l.valor_centavos;
  }
  let linhas = Object.entries(grupos).map(([nome, v]) => ({ nome, ...v, total: v.pago + v.previsto })).sort((a, b) => b.total - a.total);
  if (linhas.length > 7) {
    const resto = linhas.slice(6);
    linhas = [...linhas.slice(0, 6), resto.reduce((a, r) => ({ nome: 'Outras', pago: a.pago + r.pago, previsto: a.previsto + r.previsto, total: a.total + r.total }), { nome: 'Outras', pago: 0, previsto: 0, total: 0 })];
  }
  const maior = Math.max(1, ...linhas.map((l) => l.total));
  const categorias = linhas.length ? el('div', { class: 'cartao tela' },
    el('strong', {}, `Para onde vai o dinheiro em ${nomeMes(mes).split(' ')[0].toLowerCase()}`),
    el('div', { class: 'legenda' },
      el('span', {}, el('i', { class: 'amostra saida' }), 'Já pago'),
      el('span', {}, el('i', { class: 'amostra saida previsto' }), 'Previsto')),
    el('ul', { class: 'barras' }, linhas.map((l) => el('li', { title: `${l.nome}: pago ${reais(l.pago)} · previsto ${reais(l.previsto)}` },
      el('div', { class: 'linha' }, el('span', {}, l.nome), el('strong', {}, reais(l.total))),
      el('div', { class: 'trilho' },
        l.pago ? el('span', { class: 'seg saida', style: `width:${(l.pago / maior) * 100}%` }) : null,
        l.previsto ? el('span', { class: 'seg saida previsto', style: `width:${(l.previsto / maior) * 100}%` }) : null),
    ))),
  ) : null;

  // próximos 12 meses: entradas × saídas (realizado + previsto)
  const meses = Array.from({ length: 12 }, (_, i) => somarMes(mesHoje, i));
  const porMes = meses.map((m) => {
    const ls = anoLancs.filter((l) => l.data_competencia.startsWith(m));
    return { m, entra: ls.filter((l) => l.tipo === 'receita').reduce((a, l) => a + l.valor_centavos, 0), sai: ls.filter((l) => l.tipo === 'despesa').reduce((a, l) => a + l.valor_centavos, 0) };
  });
  const topoEscala = Math.max(1, ...porMes.flatMap((p) => [p.entra, p.sai]));
  const W = 340, H = 164, base = 124, larg = W / 12;
  const abrev = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'grafico'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Entradas e saídas previstas nos próximos 12 meses');
  const add = (tag, attrs, texto) => { const n = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (texto) n.textContent = texto; svg.append(n); return n; };
  add('line', { x1: 0, x2: W, y1: base, y2: base, class: 'eixo' });
  porMes.forEach((p, i) => {
    const x = i * larg; const bw = (larg - 6) / 2;
    const hE = (p.entra / topoEscala) * (base - 8), hS = (p.sai / topoEscala) * (base - 8);
    const g = document.createElementNS(svgNS, 'g'); svg.append(g);
    const t = document.createElementNS(svgNS, 'title'); t.textContent = `${nomeMes(p.m)}: entra ${reais(p.entra)} · sai ${reais(p.sai)} · sobra ${reais(p.entra - p.sai)}`; g.append(t);
    const r = (cls, xx, h) => { const n = document.createElementNS(svgNS, 'rect'); Object.entries({ x: xx, y: base - h, width: bw, height: Math.max(h, p.entra || p.sai ? 1 : 0), rx: 2, class: cls }).forEach(([k, v]) => n.setAttribute(k, v)); g.append(n); };
    r('entrada', x + 2, hE); r('saida', x + 2 + bw + 2, hS);
    const hit = document.createElementNS(svgNS, 'rect'); Object.entries({ x, y: 0, width: larg, height: base, fill: 'transparent' }).forEach(([k, v]) => hit.setAttribute(k, v)); g.append(hit);
    add('text', { x: x + larg / 2, y: base + 14, class: 'rotulo', 'text-anchor': 'middle' }, abrev(p.m));
    if (i === 0 || p.m.endsWith('-01')) {
      add('text', { x: x + 2, y: base + 30, class: 'rotulo ano' }, p.m.slice(0, 4));
      if (i > 0) add('line', { x1: x, x2: x, y1: 4, y2: base + 20, class: 'divisa-ano' });
    }
  });
  const tabela = el('details', {}, el('summary', {}, 'Ver em tabela'),
    el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Mês'), el('th', {}, 'Entra'), el('th', {}, 'Sai'), el('th', {}, 'Sobra'))),
      el('tbody', {}, porMes.map((p) => el('tr', {}, el('td', {}, `${abrev(p.m)}/${p.m.slice(2, 4)}`), el('td', {}, reais(p.entra)), el('td', {}, reais(p.sai)), el('td', { class: p.entra - p.sai < 0 ? 'negativo' : '' }, reais(p.entra - p.sai))))),
    ));
  const mesesBloco = el('div', { class: 'cartao tela' },
    el('strong', {}, 'Próximos 12 meses'),
    el('p', { class: 'discreto pequeno-texto' }, 'Tudo que já foi lançado ou previsto. Toque numa coluna para ver os valores.'),
    el('div', { class: 'legenda' }, el('span', {}, el('i', { class: 'amostra entrada' }), 'Entradas'), el('span', {}, el('i', { class: 'amostra saida' }), 'Saídas')),
    svg, tabela,
  );
  svg.addEventListener('click', (e) => { const t = e.target.closest('g')?.querySelector('title'); if (t) dica.textContent = t.textContent; });
  const dica = el('p', { class: 'pequeno-texto', role: 'status' });
  mesesBloco.insertBefore(dica, tabela);

  return { topo, categorias, meses: mesesBloco };
}

function formularioLancamento({ espacoId, contas, cats, podeEditar, ehDependente, aoSalvar }) {
  let tipoAtual = 'despesa';
  const valor = el('input', { inputmode: 'decimal', required: true, placeholder: '0,00', autocomplete: 'off' });
  const descricao = el('input', { maxlength: '120', placeholder: 'Ex.: coxinha da escola, mercado, salário' });
  const data = el('input', { type: 'date', required: true, value: hojeISO() });
  const categoria = el('select', {});
  const conta = el('select', {}, contas.map((c) => el('option', { value: c.id }, c.nome)));
  const observacao = el('textarea', { rows: '2', maxlength: '500', placeholder: 'Opcional. Ex.: parcela do material escolar, reembolsar depois…' });
  const previsto = el('input', { type: 'checkbox' });
  const erro = el('p', { class: 'erro', role: 'alert' });
  const botao = el('button', { type: 'submit' }, 'Salvar');

  const preencherCategorias = (selecionar = '') => {
    categoria.replaceChildren(...[
      el('option', { value: '' }, 'Escolha a categoria…'),
      ...cats.filter((c) => c.tipo === tipoAtual).map((c) => el('option', { value: c.id, selected: c.id === selecionar }, c.rotulo)),
      podeEditar && el('option', { value: '__nova' }, '+ Criar nova categoria…'),
    ].filter(Boolean));
  };
  categoria.addEventListener('change', async () => {
    if (categoria.value !== '__nova') return;
    const nome = (prompt(tipoAtual === 'receita' ? 'Nome da nova categoria de receita:' : 'Nome da nova categoria de despesa:') || '').trim();
    if (!nome) { categoria.value = ''; return; }
    const { data: nova, error } = await supabase.from('categorias')
      .insert({ espaco_id: espacoId, nome, tipo: tipoAtual }).select('id').single();
    if (error) { erro.textContent = mensagemErro(error); categoria.value = ''; return; }
    cats.unshift({ id: nova.id, tipo: tipoAtual, rotulo: nome });
    preencherCategorias(nova.id);
  });
  const botaoTipo = (t, rotulo) => el('button', { type: 'button', class: `aba ${t === tipoAtual ? 'ativa' : ''}`, onclick: (e) => {
    tipoAtual = t;
    form.querySelectorAll('.aba').forEach((b) => b.classList.remove('ativa'));
    e.currentTarget.classList.add('ativa');
    preencherCategorias();
  } }, rotulo);

  const form = el('form', { class: 'cartao tela escondido', onsubmit: async (e) => {
    e.preventDefault(); erro.textContent = '';
    const centavos = lerValor(valor.value);
    if (!centavos) { erro.textContent = 'Digite um valor maior que zero.'; return; }
    const ehPrevisto = previsto.checked;
    let status = ehPrevisto ? 'previsto' : 'confirmado';
    if (ehDependente) status = 'pendente_confirmacao';
    if (status === 'confirmado' && !conta.value) { erro.textContent = 'Cadastre uma conta abaixo, ou marque como previsão.'; return; }
    if (categoria.value === '__nova') { erro.textContent = 'Escolha a categoria.'; return; }
    botao.disabled = true;
    const { error } = await supabase.from('lancamentos').insert({
      espaco_id: espacoId,
      tipo: tipoAtual,
      status,
      descricao: descricao.value.trim(),
      valor_centavos: centavos,
      valor_previsto_centavos: ehPrevisto ? centavos : null,
      data: data.value,
      data_competencia: competencia(data.value),
      categoria_id: categoria.value || null,
      conta_id: status === 'confirmado' ? conta.value : (conta.value || null),
      observacao: observacao.value.trim() || null,
      origem: 'app',
    });
    botao.disabled = false;
    if (error) { erro.textContent = mensagemErro(error); return; }
    if (data.value.slice(0, 7) !== estado.mes) estado.mes = data.value.slice(0, 7);
    aoSalvar();
  } },
    el('div', { class: 'abas' }, botaoTipo('despesa', 'Despesa'), botaoTipo('receita', 'Receita')),
    el('label', {}, 'Valor (R$)', valor),
    el('label', {}, 'Descrição', descricao),
    el('label', {}, 'Data', data),
    el('label', {}, 'Categoria', categoria),
    contas.length ? el('label', {}, 'Conta', conta) : null,
    el('label', {}, 'Observação', observacao),
    !ehDependente && el('label', { class: 'marcar' }, previsto, 'É só uma previsão (ainda não foi pago ou recebido)'),
    ehDependente && el('p', { class: 'discreto' }, 'Seu lançamento vai para aprovação do responsável.'),
    erro, botao,
  );
  preencherCategorias();

  const abrir = el('button', { onclick: () => { form.classList.toggle('escondido'); valor.focus(); } }, '+ Novo lançamento');
  return el('div', { class: 'tela' }, abrir, form);
}

function itemLancamento(l, { nomeCat, nomeConta, contas, podeEditar, aoMudar, nomePessoa = {}, nomeRubrica = {}, nomeLocal = {}, compacto = false }) {
  const ehTransf = l.tipo === 'transferencia';
  const ids = ehTransf && l.transferencia_par_id ? [l.id, l.transferencia_par_id] : [l.id];
  const sinal = ehTransf ? '' : (l.tipo === 'receita' ? 'positivo' : 'negativo');
  const etiquetas = [];
  const SITUACAO = { pago: 'Pago', reservado: 'Reservado', a_confirmar: 'A confirmar' };
  if (l.situacao && SITUACAO[l.situacao] && !(l.situacao === 'pago' && l.status === 'confirmado')) etiquetas.push(el('span', { class: 'etiqueta' }, SITUACAO[l.situacao]));
  if (l.status === 'previsto') etiquetas.push(el('span', { class: 'etiqueta ouro' }, 'Previsto'));
  if (l.status === 'pendente_confirmacao') etiquetas.push(el('span', { class: 'etiqueta ouro' }, 'Aguardando aprovação'));
  const diferenca = l.status === 'confirmado' && l.valor_previsto_centavos && l.valor_previsto_centavos !== l.valor_centavos
    ? el('p', { class: 'discreto' }, `Previsto ${reais(l.valor_previsto_centavos)} · diferença ${reais(l.valor_centavos - l.valor_previsto_centavos)}`)
    : null;

  const acoes = el('div', { class: 'acoes' });
  const erro = el('p', { class: 'erro', role: 'alert' });
  if (podeEditar && l.status === 'previsto' && !ehTransf) {
    const estrangeira = l.moeda && l.moeda !== 'BRL' && l.cotacao;
    const novo = el('input', { inputmode: 'decimal', 'aria-label': 'Nova previsão',
      value: estrangeira ? String(l.valor_original).replace('.', ',') : (l.valor_centavos / 100).toFixed(2).replace('.', ',') });
    acoes.append(el('form', { class: 'confirmar', onsubmit: async (e) => {
      e.preventDefault();
      const v = lerNumero(novo.value);
      if (!v) { erro.textContent = 'Valor inválido. Para tirar o gasto, use “Zerar”.'; return; }
      const centavos = Math.round(v * (estrangeira ? Number(l.cotacao) : 1) * 100);
      const dados = { valor_centavos: centavos, valor_previsto_centavos: centavos };
      if (estrangeira) dados.valor_original = v;
      const { error } = await supabase.from('lancamentos').update(dados).eq('id', l.id);
      if (error) { erro.textContent = mensagemErro(error); return; }
      aoMudar();
    } }, el('span', { class: 'discreto pequeno-texto rotulo-acao' }, `Nova previsão (${estrangeira ? l.moeda : 'R$'})`), novo, el('button', { type: 'submit', class: 'pequeno secundario' }, 'Salvar previsão')));
  }
  if (podeEditar && (l.status === 'previsto' || l.status === 'pendente_confirmacao')) {
    const real = el('input', { inputmode: 'decimal', placeholder: 'Valor real', value: (l.valor_centavos / 100).toFixed(2).replace('.', ',') });
    const conta = el('select', {}, contas.map((c) => el('option', { value: c.id, selected: c.id === l.conta_id }, c.nome)));
    acoes.append(el('form', { class: 'confirmar', onsubmit: async (e) => {
      e.preventDefault();
      const centavos = lerValor(real.value);
      if (!centavos) { erro.textContent = 'Valor inválido.'; return; }
      if (!conta.value) { erro.textContent = 'Cadastre uma conta primeiro.'; return; }
      const { error } = ehTransf
        ? await supabase.from('lancamentos').update({ status: 'confirmado', valor_centavos: centavos }).in('id', ids)
        : await supabase.from('lancamentos').update({ status: 'confirmado', valor_centavos: centavos, conta_id: conta.value }).eq('id', l.id);
      if (error) { erro.textContent = mensagemErro(error); return; }
      aoMudar();
    } }, el('span', { class: 'discreto pequeno-texto rotulo-acao' }, l.status === 'previsto' ? 'Já pagou? Valor pago em R$ e de onde saiu' : 'Aprovar: valor em R$ e conta'), real, contas.length && !ehTransf ? conta : null, el('button', { type: 'submit', class: 'pequeno' }, l.status === 'previsto' ? 'Confirmar valor real' : 'Aprovar')));
  }
  if (podeEditar) {
    acoes.append(el('button', { class: 'link pequeno', onclick: async () => {
      if (!confirm('Zerar este gasto? Ele sai das contas, mas continua no histórico.')) return;
      const { error } = await supabase.from('lancamentos').update({ status: 'cancelado' }).in('id', ids);
      if (error) { erro.textContent = mensagemErro(error); return; }
      aoMudar();
    } }, 'Zerar (remover)'));
  }

  if (compacto) {
    const detalhes = [
      el('p', { class: 'discreto' }, [nomeRubrica[l.rubrica_id], nomeLocal[l.local_id]].filter(Boolean).join(' · ')),
      l.moeda && l.moeda !== 'BRL' && l.valor_original ? el('p', { class: 'discreto' }, `${numero(l.valor_original)} ${l.moeda} · cotação R$ ${numero(l.cotacao, 4)}`) : null,
      l.favorecido && l.status !== 'confirmado' ? el('p', { class: 'discreto' }, `A pagar para ${l.favorecido}`) : null,
      l.status === 'confirmado' && l.pago_por && nomePessoa[l.pago_por] ? el('p', { class: 'discreto' }, `Pago por ${nomePessoa[l.pago_por]}${l.conta_id && nomeConta[l.conta_id] ? ` · ${nomeConta[l.conta_id]}` : ''}`) : null,
      l.observacao ? el('p', { class: 'observacao' }, l.observacao) : null,
      diferenca,
    ].filter(Boolean);
    const painelC = el('div', { class: 'tela escondido detalhe' }, detalhes, acoes, erro);
    const SIT = { pago: 'pago', reservado: 'reservado', a_confirmar: 'a confirmar' };
    const marcaStatus = l.status === 'confirmado' ? el('span', { class: 'ponto ok', title: 'Já pago' }, '✓')
      : el('span', { class: 'ponto', title: 'Previsto' }, '○');
    return el('li', { class: `item-compacto ${l.status === 'confirmado' ? 'pago' : ''}` },
      el('button', { type: 'button', class: 'linha item-linha', onclick: () => painelC.classList.toggle('escondido') },
        el('span', { class: 'item-nome' }, marcaStatus, ' ', l.descricao || nomeRubrica[l.rubrica_id] || 'Gasto',
          l.situacao && SIT[l.situacao] && l.status !== 'confirmado' ? el('span', { class: 'etiqueta mini' }, SIT[l.situacao]) : null),
        el('span', { class: 'item-valor' }, reais(l.valor_centavos))),
      painelC,
    );
  }
  const painel = el('div', { class: 'tela escondido' }, acoes);
  return el('li', { class: 'cartao' },
    el('div', { class: 'linha' },
      el('strong', {}, l.descricao || nomeCat[l.categoria_id] || (ehTransf ? 'Transferência' : l.tipo === 'receita' ? 'Receita' : 'Despesa')),
      el('strong', { class: sinal }, (ehTransf ? (l.transferencia_sentido === 'saida' ? '↗ ' : '↘ ') : l.tipo === 'despesa' ? '− ' : '+ ') + reais(l.valor_centavos)),
    ),
    el('p', { class: 'discreto' }, [dataCurta(l.data), ehTransf ? `Transferência · ${l.transferencia_sentido === 'saida' ? 'saiu de' : 'entrou em'} ${nomeConta[l.conta_id] || 'outra conta'}` : nomeCat[l.categoria_id], ehTransf ? null : nomeConta[l.conta_id]].filter(Boolean).join(' · ')),
    l.moeda && l.moeda !== 'BRL' && l.valor_original ? el('p', { class: 'discreto' }, `${numero(l.valor_original)} ${l.moeda} · cotação R$ ${numero(l.cotacao, 4)}`) : null,
    (l.rubrica_id && nomeRubrica[l.rubrica_id]) || (l.local_id && nomeLocal[l.local_id]) || l.favorecido || (l.pago_por && nomePessoa[l.pago_por])
      ? el('p', { class: 'discreto' }, [nomeRubrica[l.rubrica_id], nomeLocal[l.local_id],
          l.favorecido && l.status !== 'confirmado' ? `a pagar para ${l.favorecido}` : null,
          l.status === 'confirmado' && l.pago_por && nomePessoa[l.pago_por] ? `pago por ${nomePessoa[l.pago_por]}` : null].filter(Boolean).join(' · ')) : null,
    l.observacao ? el('p', { class: 'observacao' }, l.observacao) : null,
    etiquetas.length ? el('div', { class: 'acoes' }, etiquetas) : null,
    diferenca,
    acoes.childElementCount ? el('button', { class: 'link pequeno', onclick: (e) => { painel.classList.toggle('escondido'); e.currentTarget.textContent = painel.classList.contains('escondido') ? 'Ajustar ▾' : 'Fechar ▴'; } }, 'Ajustar ▾') : null,
    painel, erro,
  );
}

function formularioConta(espacoId, aoSalvar) {
  const nome = el('input', { required: true, maxlength: '60', placeholder: 'Ex.: Nubank, Itaú, Dinheiro' });
  const tipo = el('select', {}, Object.entries(NOMES_CONTA).map(([v, r]) => el('option', { value: v }, r)));
  const saldoIni = el('input', { inputmode: 'decimal', placeholder: '0,00' });
  const erro = el('p', { class: 'erro', role: 'alert' });
  const form = el('form', { class: 'cartao tela escondido', onsubmit: async (e) => {
    e.preventDefault();
    const s = saldoIni.value.trim() ? lerValor(saldoIni.value.replace('-', '')) : 0;
    if (s === null) { erro.textContent = 'Saldo inválido.'; return; }
    const negativo = saldoIni.value.trim().startsWith('-');
    const { error } = await supabase.from('contas').insert({
      espaco_id: espacoId, nome: nome.value.trim(), tipo: tipo.value,
      saldo_inicial_centavos: negativo ? -s : s, data_saldo_inicial: hojeISO(),
    });
    if (error) { erro.textContent = mensagemErro(error); return; }
    aoSalvar();
  } },
    el('label', {}, 'Nome da conta', nome),
    el('label', {}, 'Tipo', tipo),
    el('label', {}, 'Saldo de hoje (R$)', saldoIni),
    erro, el('button', { type: 'submit' }, 'Salvar conta'),
  );
  return el('div', { class: 'tela' }, el('button', { class: 'secundario', onclick: () => { form.classList.toggle('escondido'); nome.focus(); } }, '+ Nova conta'), form);
}

function formularioTransferencia(contas, aoSalvar, espacoAtual = null) {
  const rotulo = (c) => (c.espaco_nome && c.espaco_id !== espacoAtual ? `${c.nome} (${c.espaco_nome})` : c.nome);
  const daqui = contas.filter((c) => !espacoAtual || c.espaco_id === espacoAtual);
  const de = el('select', {}, contas.map((c) => el('option', { value: c.id, selected: c.id === (contas.find((x) => x.espaco_id !== espacoAtual) || {}).id }, rotulo(c))));
  const para = el('select', {}, contas.map((c) => el('option', { value: c.id, selected: c.id === (daqui[0] || {}).id }, rotulo(c))));
  const valor = el('input', { inputmode: 'decimal', required: true, placeholder: '0,00' });
  const data = el('input', { type: 'date', required: true, value: hojeISO() });
  const desc = el('input', { maxlength: '120', placeholder: 'Ex.: dinheiro para a viagem, compra de baht' });
  const prev = el('input', { type: 'checkbox' });
  const erro = el('p', { class: 'erro', role: 'alert' });
  const form = el('form', { class: 'cartao tela escondido', onsubmit: async (e) => {
    e.preventDefault(); erro.textContent = '';
    const v = lerValor(valor.value);
    if (!v) { erro.textContent = 'Digite o valor.'; return; }
    if (de.value === para.value) { erro.textContent = 'Escolha contas diferentes.'; return; }
    const { error } = await supabase.rpc('criar_transferencia', {
      p_conta_origem: de.value, p_conta_destino: para.value, p_valor_centavos: v, p_data: data.value,
      p_previsto: prev.checked, p_descricao: desc.value.trim() || 'Transferência', p_observacao: null,
    });
    if (error) { erro.textContent = mensagemErro(error); return; }
    aoSalvar();
  } },
    el('p', { class: 'discreto' }, 'Dinheiro que muda de lugar entre contas suas, inclusive de um espaço para outro (ex.: do Santander do Pessoal para a Wise da viagem). Não conta como gasto nem como receita.'),
    el('label', {}, 'Sai de', de), el('label', {}, 'Entra em', para),
    el('label', {}, 'Valor em reais', valor), el('label', {}, 'Data', data), el('label', {}, 'Descrição', desc),
    el('label', { class: 'marcar' }, prev, 'É só uma previsão'),
    erro, el('button', { type: 'submit' }, 'Transferir'),
  );
  return el('div', { class: 'tela' }, el('button', { class: 'secundario', onclick: () => { form.classList.toggle('escondido'); valor.focus(); } }, '⇄ Transferir entre contas'), form);
}

function formularioConvite(espacoId, aoSalvar) {
  const email = el('input', { type: 'email', required: true, placeholder: 'e-mail que a pessoa usa no app' });
  const papel = el('select', {},
    el('option', { value: 'editor' }, 'Pode editar'),
    el('option', { value: 'leitor' }, 'Só leitura'),
    el('option', { value: 'dependente' }, 'Dependente (menor de idade)'));
  const msg = el('p', { class: 'discreto', role: 'status' });
  const form = el('form', { class: 'cartao tela escondido', onsubmit: async (e) => {
    e.preventDefault();
    const { error } = await supabase.rpc('convidar_membro', { p_espaco: espacoId, p_email: email.value.trim(), p_papel: papel.value });
    if (error) { msg.className = 'erro'; msg.textContent = mensagemErro(error); return; }
    aoSalvar();
  } },
    el('p', { class: 'discreto' }, 'A pessoa precisa ter entrado no app uma vez antes. Ela só verá o que for deste espaço; os dados pessoais dela e os seus continuam separados.'),
    el('label', {}, 'E-mail', email),
    el('label', {}, 'Permissão', papel),
    msg, el('button', { type: 'submit' }, 'Adicionar'),
  );
  return el('div', { class: 'tela' }, el('button', { class: 'secundario', onclick: () => { form.classList.toggle('escondido'); email.focus(); } }, '+ Adicionar pessoa'), form);
}

// ---------- viagens e projetos ----------
const MOEDAS = { BRL: 'Real (R$)', THB: 'Baht tailandês (THB)', INR: 'Rúpia indiana (INR)', USD: 'Dólar (US$)', EUR: 'Euro (€)' };
const RUBRICAS_VIAGEM = ['Passagens', 'Hospedagem', 'Alimentação', 'Passeios', 'Transporte', 'Compras', 'Seguro e vistos', 'Outros'];
const cotacoes = {};

// Cotação oficial: baixa da internet e guarda no aparelho; sem internet, usa a última guardada.
async function buscarCotacao(moeda) {
  if (moeda === 'BRL') return { valor: 1, data: hojeISO() };
  if (cotacoes[moeda]) return cotacoes[moeda];
  if (await atualizarCotacoes([...new Set([...MOEDAS_CONV, moeda])])) {
    const c = cotacaoDe(moeda, { aceitarManual: false });
    if (c) { cotacoes[moeda] = c; return c; }
  }
  const salva = cotacaoDe(moeda, { aceitarManual: false });
  return salva ? { ...salva, guardada: true } : null;
}

function lerNumero(texto) {
  let t = String(texto).trim().replace(/[^\d.,]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function diasEntre(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }

function graficoEvolucao(despesas, inicio, fim) {
  const ativos = despesas.filter((l) => l.status !== 'cancelado');
  if (!ativos.length) return null;
  const datas = ativos.map((l) => l.data).sort();
  const d0 = [datas[0], inicio].filter(Boolean).sort()[0];
  const d1 = [datas.at(-1), fim].filter(Boolean).sort().at(-1);
  const total = diasEntre(d0, d1) + 1;
  const dias = Array.from({ length: total }, (_, i) => new Date(Date.parse(`${d0}T12:00:00`) + i * 864e5).toISOString().slice(0, 10));
  let acP = 0, acR = 0;
  const serie = dias.map((d) => {
    const doDia = ativos.filter((l) => l.data === d);
    acP += doDia.reduce((a, l) => a + l.valor_centavos, 0);
    acR += doDia.filter((l) => l.status === 'confirmado').reduce((a, l) => a + l.valor_centavos, 0);
    return { d, p: acP, r: acR };
  });
  const W = 340, H = 190, esq = 4, base = 150, topo = 14;
  const max = Math.max(1, acP);
  const X = (i) => esq + (i / Math.max(1, total - 1)) * (W - esq - 8);
  const Y = (v) => base - (v / max) * (base - topo);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'grafico'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Gasto acumulado da viagem: planejado e realizado');
  const add = (tag, attrs, texto, pai = svg) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (texto) n.textContent = texto; pai.append(n); return n; };
  add('line', { x1: 0, x2: W, y1: base, y2: base, class: 'eixo' });
  add('polyline', { points: serie.map((s, i) => `${X(i)},${Y(s.p)}`).join(' '), class: 'linha-planejado' });
  add('polyline', { points: serie.map((s, i) => `${X(i)},${Y(s.r)}`).join(' '), class: 'linha-realizado' });
  serie.forEach((s, i) => {
    const g = add('g', {});
    add('title', {}, `${dataCurta(s.d)}: planejado até aqui ${reais(s.p)} · gasto ${reais(s.r)}`, g);
    add('rect', { x: X(i) - (W / total) / 2, y: 0, width: W / total, height: base, fill: 'transparent' }, null, g);
  });
  [0, Math.floor((total - 1) / 2), total - 1].forEach((i) => add('text', { x: X(i), y: base + 16, class: 'rotulo', 'text-anchor': i === 0 ? 'start' : i === total - 1 ? 'end' : 'middle' }, dataCurta(dias[i])));
  add('text', { x: W - 8, y: Y(acP) - 4, class: 'rotulo valor-final', 'text-anchor': 'end' }, reais(acP));
  const dica = el('p', { class: 'pequeno-texto', role: 'status' }, `Planejado: ${reais(acP)} · Gasto até agora: ${reais(acR)}`);
  svg.addEventListener('click', (e) => { const t = e.target.closest('g')?.querySelector('title'); if (t) dica.textContent = t.textContent; });
  return el('div', { class: 'cartao tela' },
    el('strong', {}, 'Evolução do gasto (acumulado)'),
    el('div', { class: 'legenda' }, el('span', {}, el('i', { class: 'amostra entrada' }), 'Planejado'), el('span', {}, el('i', { class: 'amostra saida' }), 'Gasto real')),
    svg, dica,
  );
}

function roteiroDiaADia(lancs, item, nomeLocal, aoLancarNoDia, inicio, fim) {
  const dias = {};
  for (const l of lancs) (dias[l.data] = dias[l.data] || []).push(l);
  // inclui os dias da viagem que ainda não têm nada lançado
  if (inicio && fim) for (let t = Date.parse(`${inicio}T12:00:00`); t <= Date.parse(`${fim}T12:00:00`); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10); dias[d] = dias[d] || [];
  }
  const hoje = hojeISO();
  const futuros = Object.keys(dias).sort().filter((d) => d >= hoje);
  const abrir = futuros.includes(hoje) ? hoje : null;
  return el('div', { class: 'roteiro' }, Object.keys(dias).sort().map((d) => {
    const ls = dias[d].filter((l) => l.tipo === 'despesa');
    const planejado = ls.reduce((a, l) => a + (l.valor_previsto_centavos || l.valor_centavos), 0);
    const gasto = ls.filter((l) => l.status === 'confirmado').reduce((a, l) => a + l.valor_centavos, 0);
    const locais = [...new Set(ls.map((l) => nomeLocal[l.local_id]).filter(Boolean))].join(' · ');
    const semana = new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const passou = d < hoje;
    const det = el('details', { class: `dia ${passou ? 'passado' : ''} ${d === hoje ? 'hoje' : ''}`, open: d === abrir },
      el('summary', {},
        el('div', { class: 'dia-cab' },
          el('strong', {}, `${semana} ${dataCurta(d)}`),
          locais ? el('span', { class: 'discreto' }, locais) : null),
        el('div', { class: 'dia-valores' },
          el('span', {}, el('span', { class: 'discreto' }, 'Planejado '), el('strong', {}, reais(planejado))),
          el('span', {}, el('span', { class: 'discreto' }, 'Gasto '), el('strong', { class: gasto > planejado ? 'negativo' : '' }, reais(gasto))))),
      ls.length ? el('ul', { class: 'itens-dia' }, ls.map(item)) : el('p', { class: 'discreto' }, 'Nada planejado.'),
      aoLancarNoDia ? el('button', { type: 'button', class: 'secundario pequeno', onclick: (e) => aoLancarNoDia(d, ls.find((l) => l.local_id)?.local_id, e.currentTarget) }, '+ Lançar gasto deste dia') : null,
    );
    return det;
  }));
}

// Conversor rápido: digita na moeda local e vê em reais (ou o contrário)
function conversorRapido(moedas) {
  const estrangeiras = moedas.filter((m) => m !== 'BRL');
  if (!estrangeiras.length) return null;
  let paraReal = true;
  const valor = el('input', { inputmode: 'decimal', placeholder: '0', autocomplete: 'off', 'aria-label': 'Valor para converter' });
  const moeda = el('select', { 'aria-label': 'Moeda' }, estrangeiras.map((m) => el('option', { value: m }, m)));
  const resultado = el('strong', { class: 'conversao' }, '—');
  const detalhe = el('p', { class: 'discreto pequeno-texto' });
  const sentido = el('button', { type: 'button', class: 'secundario pequeno', 'aria-label': 'Inverter a conversão' });
  const desenhar = async () => {
    sentido.textContent = paraReal ? `${moeda.value} → R$` : `R$ → ${moeda.value}`;
    valor.placeholder = paraReal ? `valor em ${moeda.value}` : 'valor em reais';
    const v = lerNumero(valor.value);
    const c = await buscarCotacao(moeda.value);
    if (!c) { resultado.textContent = 'Sem cotação agora'; detalhe.textContent = 'Sem internet e nenhuma cotação guardada ainda.'; return; }
    if (!v) { resultado.textContent = '—'; detalhe.textContent = `1 ${moeda.value} = R$ ${numero(c.valor, 4)} (cotação de ${c.data.split('-').reverse().join('/')})`; return; }
    if (paraReal) {
      const r = Math.round(v * c.valor * 100);
      resultado.textContent = `≈ ${reais(r)}`;
      detalhe.textContent = `No cartão de crédito brasileiro, com IOF de 3,5%: ≈ ${reais(Math.round(r * 1.035))}. Cotação de ${c.data.split('-').reverse().join('/')}${c.guardada ? ' (guardada, sem internet)' : ''}.`;
    } else {
      resultado.textContent = `≈ ${numero(v / c.valor)} ${moeda.value}`;
      detalhe.textContent = `1 ${moeda.value} = R$ ${numero(c.valor, 4)}.`;
    }
  };
  sentido.addEventListener('click', () => { paraReal = !paraReal; desenhar(); valor.focus(); });
  valor.addEventListener('input', desenhar); moeda.addEventListener('change', desenhar);
  desenhar();
  return el('div', { class: 'cartao tela' },
    el('div', { class: 'linha' }, el('strong', {}, 'Conversor rápido'), sentido),
    el('div', { class: 'grade-valor' }, valor, moeda),
    resultado, detalhe,
    el('a', { href: `/conversor.html?moeda=${encodeURIComponent(moeda.value)}&voltar=${encodeURIComponent(location.pathname + location.hash)}`, class: 'pequeno-texto' }, 'Abrir conversor em tela cheia (funciona sem internet) ›'),
  );
}

function blocoProjetos(espacoId, projetos, podeEditar) {
  const nome = el('input', { required: true, maxlength: '80', placeholder: 'Ex.: Tailândia e Índia 2026' });
  const tipo = el('select', {},
    el('option', { value: 'viagem' }, 'Viagem'), el('option', { value: 'evento' }, 'Passeio ou evento'),
    el('option', { value: 'reforma' }, 'Reforma'), el('option', { value: 'outro' }, 'Outro'));
  const inicio = el('input', { type: 'date' });
  const fim = el('input', { type: 'date' });
  const marcas = ['THB', 'INR', 'USD', 'EUR'].map((m) => {
    const cb = el('input', { type: 'checkbox', value: m, checked: m === 'THB' || m === 'INR' });
    return { m, cb, rotulo: el('label', { class: 'marcar' }, cb, MOEDAS[m]) };
  });
  const erro = el('p', { class: 'erro', role: 'alert' });
  const form = el('form', { class: 'cartao tela escondido', onsubmit: async (e) => {
    e.preventDefault(); erro.textContent = '';
    if (inicio.value && fim.value && fim.value < inicio.value) { erro.textContent = 'A volta precisa ser depois da ida.'; return; }
    const moedas = ['BRL', ...marcas.filter((x) => x.cb.checked).map((x) => x.m)];
    const { data: proj, error } = await supabase.from('projetos').insert({
      espaco_id: espacoId, nome: nome.value.trim(), tipo: tipo.value,
      data_inicio: inicio.value || null, data_fim: fim.value || null, moedas,
    }).select('id').single();
    if (error) { erro.textContent = mensagemErro(error); return; }
    const itens = tipo.value === 'viagem' ? RUBRICAS_VIAGEM : ['Gastos'];
    const { error: e2 } = await supabase.from('projeto_rubricas')
      .insert(itens.map((n, i) => ({ espaco_id: espacoId, projeto_id: proj.id, nome: n, ordem: i })));
    if (e2) { erro.textContent = mensagemErro(e2); return; }
    location.hash = `#/projeto/${proj.id}`;
  } },
    el('strong', {}, 'Nova viagem ou projeto'),
    el('label', {}, 'Nome', nome),
    el('label', {}, 'Tipo', tipo),
    el('div', { class: 'grade2' }, el('label', {}, 'Ida / início', inicio), el('label', {}, 'Volta / fim', fim)),
    el('p', { class: 'discreto' }, 'Moedas que vão usar (o real já está incluído):'),
    marcas.map((x) => x.rotulo),
    erro, el('button', { type: 'submit' }, 'Criar'),
  );

  const lista = projetos.length ? el('ul', { class: 'lista' }, projetos.map((p) => {
    const orc = p.projeto_rubricas.reduce((a, r) => a + r.valor_previsto_centavos, 0);
    const gasto = p.lancamentos.filter((l) => l.tipo === 'despesa' && l.status !== 'cancelado').reduce((a, l) => a + l.valor_centavos, 0);
    const datas = p.data_inicio ? `${dataCurta(p.data_inicio)}${p.data_fim ? ` a ${dataCurta(p.data_fim)}` : ''}` : '';
    return el('li', {}, el('a', { class: 'cartao clicavel', href: `#/projeto/${p.id}` },
      el('div', { class: 'linha' }, el('strong', {}, p.nome), datas && el('span', { class: 'etiqueta' }, datas)),
      el('div', { class: 'linha' }, el('span', { class: 'discreto' }, orc ? `Orçamento ${reais(orc)}` : 'Sem orçamento ainda'), el('strong', {}, reais(gasto))),
      orc ? el('div', { class: 'trilho' }, el('span', { class: 'seg saida', style: `width:${Math.min(100, (gasto / orc) * 100)}%` })) : null,
    ));
  })) : el('p', { class: 'discreto' }, 'Crie uma viagem, passeio ou evento para acompanhar o orçamento separado do dia a dia.');

  return el('div', { class: 'tela' },
    el('h2', {}, 'Viagens e projetos'), lista,
    podeEditar && el('button', { class: 'secundario', onclick: () => { form.classList.toggle('escondido'); nome.focus(); } }, '+ Nova viagem ou projeto'),
    podeEditar && form,
  );
}

async function telaProjeto(projetoId) {
  const pR = await supabase.from('projetos').select('*').eq('id', projetoId).single();
  if (pR.error) return telaErro(`Não foi possível abrir: ${mensagemErro(pR.error)}`);
  const proj = pR.data; const espacoId = proj.espaco_id;
  const [espR, papelR, rubR, locR, lancR, contasR, membrosR] = await Promise.all([
    supabase.from('espacos').select('id, nome, tipo').eq('id', espacoId).single(),
    supabase.from('membros_espaco').select('papel').eq('espaco_id', espacoId).eq('usuario_id', usuario.id).single(),
    supabase.from('projeto_rubricas').select('id, nome, valor_previsto_centavos, ordem').eq('projeto_id', projetoId).order('ordem'),
    supabase.from('projeto_locais').select('id, nome, valor_previsto_centavos, data_inicio, data_fim, ordem').eq('projeto_id', projetoId).order('ordem'),
    supabase.from('lancamentos')
      .select('id, tipo, status, descricao, observacao, valor_centavos, valor_previsto_centavos, data, categoria_id, conta_id, moeda, valor_original, cotacao, rubrica_id, local_id, favorecido, pago_por, situacao')
      .eq('projeto_id', projetoId).neq('status', 'cancelado').order('data').order('criado_em'),
    supabase.from('contas').select('id, nome, tipo, saldo_inicial_centavos').eq('espaco_id', espacoId).eq('ativa', true).order('nome'),
    supabase.from('membros_espaco').select('usuario_id, papel, perfis ( nome )').eq('espaco_id', espacoId),
  ]);
  const falha = [espR, papelR, rubR, locR, lancR, contasR, membrosR].find((r) => r.error);
  if (falha) return telaErro(`Não foi possível abrir: ${mensagemErro(falha.error)}`);
  let cats, editaveis, movs;
  try {
    [cats, editaveis, movs] = await Promise.all([carregarCategorias(espacoId), contasEditaveis(), movimentosDasContas(contasR.data.map((c) => c.id))]);
  } catch (e) { return telaErro(mensagemErro(e)); }
  const ehEspacoViagem = espR.data.tipo === 'viagem';
  const locais = locR.data;
  const nomeLocal = Object.fromEntries(locais.map((l) => [l.id, l.nome]));

  const papel = papelR.data.papel; const podeEditar = papel === 'dono' || papel === 'editor';
  const rubricas = rubR.data; const lancs = lancR.data; const contas = contasR.data;
  const nomePessoa = Object.fromEntries(membrosR.data.map((m) => [m.usuario_id, (m.perfis && m.perfis.nome) || 'Sem nome']));
  const nomeRubrica = Object.fromEntries(rubricas.map((r) => [r.id, r.nome]));
  // contas que podem pagar gastos da viagem: as da viagem e as suas de outros espaços (ex.: Santander do Pessoal)
  const contasPagamento = [...contas.map((c) => ({ ...c, espaco_id: espacoId })), ...editaveis.filter((c) => c.espaco_id !== espacoId)];
  const nomeConta = Object.fromEntries(contasPagamento.map((c) => [c.id, c.espaco_id === espacoId ? c.nome : `${c.nome} (${c.espaco_nome})`]));
  const nomeCat = Object.fromEntries(cats.map((c) => [c.id, c.rotulo]));
  const catViagem = (cats.find((c) => c.rotulo === 'Lazer › Viagens') || {}).id || null;
  const recarregar = () => telaProjeto(projetoId);

  const despesas = lancs.filter((l) => l.tipo === 'despesa');
  const orcamento = rubricas.reduce((a, r) => a + r.valor_previsto_centavos, 0);
  const gasto = despesas.filter((l) => l.status === 'confirmado').reduce((a, l) => a + l.valor_centavos, 0);
  const aPagar = despesas.filter((l) => l.status !== 'confirmado').reduce((a, l) => a + l.valor_centavos, 0);
  const sobra = orcamento - gasto - aPagar;

  // dias da viagem
  const hoje = hojeISO();
  let infoDias = null; let porDia = null;
  if (proj.data_inicio && proj.data_fim) {
    const total = diasEntre(proj.data_inicio, proj.data_fim) + 1;
    if (hoje < proj.data_inicio) {
      infoDias = `Faltam ${diasEntre(hoje, proj.data_inicio)} dias para começar · ${total} dias no total`;
      porDia = orcamento ? Math.max(0, Math.floor((orcamento - gasto - aPagar) / total)) : null;
    } else if (hoje <= proj.data_fim) {
      const decorridos = diasEntre(proj.data_inicio, hoje) + 1; const restantes = total - decorridos + 1;
      const noPeriodo = despesas.filter((l) => l.status === 'confirmado' && l.data >= proj.data_inicio && l.data <= hoje).reduce((a, l) => a + l.valor_centavos, 0);
      infoDias = `Dia ${decorridos} de ${total} · média de ${reais(Math.round(noPeriodo / decorridos))} por dia até agora`;
      porDia = orcamento ? Math.max(0, Math.floor(sobra / restantes)) : null;
    } else {
      infoDias = `Encerrada · ${total} dias`;
    }
  }

  const tile = (rotulo, valor, classe = '') => el('div', { class: `cartao kpi ${classe}` }, el('span', { class: 'discreto' }, rotulo), el('strong', { class: 'kpi-valor' }, reais(valor)));
  const resumo = el('div', { class: 'tela' },
    el('div', { class: 'kpis' },
      tile('Orçamento', orcamento), tile('Já gasto', gasto), tile('Ainda sobra', sobra, sobra < 0 ? 'alerta' : '')),
    aPagar ? el('p', { class: 'discreto' }, `Previsto a pagar (reservas etc.): ${reais(aPagar)}`) : null,
    infoDias && el('p', { class: 'discreto' }, infoDias),
    porDia != null && el('p', { class: 'aviso' }, `Para caber no orçamento: até ${reais(porDia)} por dia.`),
  );

  // itens do orçamento
  const usoRubrica = (id) => despesas.filter((l) => l.rubrica_id === id && l.status === 'confirmado').reduce((a, l) => a + l.valor_centavos, 0);
  const maiorRub = Math.max(1, ...rubricas.map((r) => Math.max(r.valor_previsto_centavos, usoRubrica(r.id))));
  const blocoRubricas = el('div', { class: 'cartao tela' },
    el('strong', {}, 'Por tipo de gasto: planejado × gasto'),
    el('div', { class: 'legenda' }, el('span', {}, el('i', { class: 'amostra saida' }), 'Gasto'), el('span', {}, el('i', { class: 'amostra saida previsto' }), 'Falta (planejado)')),
    el('ul', { class: 'barras' }, rubricas.map((r) => {
      const usado = usoRubrica(r.id);
      return el('li', {},
        el('div', { class: 'linha' }, el('span', {}, r.nome),
          el('span', {}, el('strong', { class: usado > r.valor_previsto_centavos && r.valor_previsto_centavos ? 'negativo' : '' }, reais(usado)), ` de ${reais(r.valor_previsto_centavos)}`)),
        el('div', { class: 'trilho fundo' },
          el('span', { class: 'seg saida', style: `width:${(usado / maiorRub) * 100}%` }),
          r.valor_previsto_centavos > usado ? el('span', { class: 'seg saida previsto', style: `width:${((r.valor_previsto_centavos - usado) / maiorRub) * 100}%` }) : null),
        podeEditar && el('button', { class: 'link pequeno', onclick: async () => {
          const t = prompt(`Quanto vocês querem gastar com "${r.nome}"? (R$)`, (r.valor_previsto_centavos / 100).toFixed(2).replace('.', ','));
          if (t == null) return;
          const v = t.trim() === '0' ? 0 : lerValor(t); if (v === null) { alert('Valor inválido.'); return; }
          const { error } = await supabase.from('projeto_rubricas').update({ valor_previsto_centavos: v }).eq('id', r.id);
          if (error) { alert(mensagemErro(error)); return; } recarregar();
        } }, 'Definir valor'),
      );
    })),
    podeEditar && el('button', { class: 'link', onclick: async () => {
      const n = (prompt('Nome do novo item (ex.: Massagens, Ingressos):') || '').trim(); if (!n) return;
      const { error } = await supabase.from('projeto_rubricas').insert({ espaco_id: espacoId, projeto_id: projetoId, nome: n, ordem: rubricas.length });
      if (error) { alert(mensagemErro(error)); return; } recarregar();
    } }, '+ Item no orçamento'),
  );

  // dinheiro para a viagem: carteiras digitais (ex.: Wise) e dinheiro em espécie
  const saldos = calcularSaldos(contas, movs);
  const contasViagem = contas.filter((c) => c.tipo === 'carteira_digital' || c.tipo === 'dinheiro');
  const blocoDinheiro = el('div', { class: 'cartao tela' },
    el('div', { class: 'linha' }, el('strong', {}, 'Dinheiro para a viagem'), el('strong', {}, reais(contasViagem.reduce((a, c) => a + saldos[c.id], 0)))),
    contasViagem.length
      ? contasViagem.map((c) => el('div', { class: 'linha' }, el('span', {}, c.nome), el('strong', {}, reais(saldos[c.id]))))
      : el('p', { class: 'discreto' }, `Cadastre no espaço “${espR.data.nome}” uma conta “Wise” (tipo Carteira digital) e uma “Dinheiro em espécie” (tipo Dinheiro). Depois use “⇄ Transferir entre contas” para registrar o dinheiro colocado nelas.`),
    contasViagem.length ? el('p', { class: 'discreto pequeno-texto' }, 'Valores em reais. Gastos pagos por essas contas descontam daqui. Se o saldo real da Wise ficar diferente por causa do câmbio, use “Ajustar saldo” na conta.') : null,
    el('a', { class: 'link', href: `#/espaco/${espacoId}` }, 'Ir para as contas do espaço'),
  );

  // a pagar para pessoas (ex.: Thiago, que já comprou passagens e hotel)
  const devidos = {};
  despesas.filter((l) => l.status !== 'confirmado' && l.favorecido).forEach((l) => {
    devidos[l.favorecido] = devidos[l.favorecido] || { total: 0, itens: [] };
    devidos[l.favorecido].total += l.valor_centavos; devidos[l.favorecido].itens.push(l);
  });
  const blocoDevidos = Object.keys(devidos).length > 0 && el('div', { class: 'cartao tela' },
    el('strong', {}, 'A pagar para pessoas'),
    Object.entries(devidos).map(([quem, d]) => el('div', { class: 'tela' },
      el('div', { class: 'linha' }, el('span', {}, quem), el('strong', { class: 'negativo' }, reais(d.total))),
      el('ul', { class: 'vencimentos' }, d.itens.map((l) => el('li', { class: 'linha' },
        el('span', { class: 'discreto' }, l.descricao || nomeRubrica[l.rubrica_id] || 'Sem descrição'), el('span', {}, reais(l.valor_centavos))))),
    )),
    el('p', { class: 'discreto pequeno-texto' }, 'Quando pagar, toque em “Confirmar valor real” no gasto e escolha de qual conta saiu (pode ser o Santander do Pessoal).'),
  );

  // reserva por localidade
  const usoLocal = (id) => despesas.filter((l) => l.local_id === id && l.status === 'confirmado').reduce((a, l) => a + l.valor_centavos, 0);
  const maiorLocal = Math.max(1, ...locais.map((r) => Math.max(r.valor_previsto_centavos, usoLocal(r.id))));
  const blocoLocais = el('div', { class: 'cartao tela' },
    el('strong', {}, 'Reserva por local'),
    locais.length ? el('ul', { class: 'barras' }, locais.map((r) => {
      const usado = usoLocal(r.id);
      return el('li', {},
        el('div', { class: 'linha' }, el('span', {}, r.nome + (r.data_inicio ? ` · ${dataCurta(r.data_inicio)}${r.data_fim ? `–${dataCurta(r.data_fim)}` : ''}` : '')),
          el('span', {}, el('strong', { class: usado > r.valor_previsto_centavos && r.valor_previsto_centavos ? 'negativo' : '' }, reais(usado)), ` de ${reais(r.valor_previsto_centavos)}`)),
        el('div', { class: 'trilho' },
          el('span', { class: 'seg saida', style: `width:${(usado / maiorLocal) * 100}%` }),
          r.valor_previsto_centavos > usado ? el('span', { class: 'seg saida previsto', style: `width:${((r.valor_previsto_centavos - usado) / maiorLocal) * 100}%` }) : null),
        podeEditar && el('button', { class: 'link pequeno', onclick: async () => {
          const t = prompt(`Quanto reservar para ${r.nome}? (R$)`, (r.valor_previsto_centavos / 100).toFixed(2).replace('.', ','));
          if (t == null) return;
          const v = t.trim() === '0' ? 0 : lerValor(t); if (v === null) { alert('Valor inválido.'); return; }
          const { error } = await supabase.from('projeto_locais').update({ valor_previsto_centavos: v }).eq('id', r.id);
          if (error) { alert(mensagemErro(error)); return; } recarregar();
        } }, 'Definir reserva'));
    })) : el('p', { class: 'discreto' }, 'Cadastre as cidades da viagem para separar uma reserva para cada uma.'),
    podeEditar && el('button', { class: 'link', onclick: async () => {
      const n = (prompt('Nome do local (ex.: Bangkok, Chiang Mai, Nova Délhi):') || '').trim(); if (!n) return;
      const { error } = await supabase.from('projeto_locais').insert({ espaco_id: espacoId, projeto_id: projetoId, nome: n, ordem: locais.length });
      if (error) { alert(mensagemErro(error)); return; } recarregar();
    } }, '+ Local'),
  );

  // quem pagou
  const porPessoa = {};
  despesas.filter((l) => l.status === 'confirmado' && l.pago_por).forEach((l) => { porPessoa[l.pago_por] = (porPessoa[l.pago_por] || 0) + l.valor_centavos; });
  const blocoPessoas = Object.keys(porPessoa).length > 0 && el('div', { class: 'cartao tela' },
    el('strong', {}, 'Quem pagou'),
    Object.entries(porPessoa).map(([id, v]) => el('div', { class: 'linha' }, el('span', {}, nomePessoa[id] || 'Alguém'), el('strong', {}, reais(v)))),
  );

  // formulário de gasto da viagem
  const valor = el('input', { inputmode: 'decimal', required: true, placeholder: '0,00', autocomplete: 'off' });
  const moeda = el('select', {}, (proj.moedas || ['BRL']).map((m) => el('option', { value: m }, m)));
  const cot = el('input', { inputmode: 'decimal', placeholder: 'R$ por 1 unidade' });
  const previa = el('p', { class: 'discreto', role: 'status' });
  const desc = el('input', { maxlength: '120', placeholder: 'Ex.: jantar, tuk-tuk, templo' });
  const data = el('input', { type: 'date', required: true, value: hoje });
  const rub = el('select', {}, el('option', { value: '' }, 'Escolha o item…'), rubricas.map((r) => el('option', { value: r.id }, r.nome)));
  const ordemConta = (c) => (c.espaco_id !== espacoId ? 3 : c.tipo === 'carteira_digital' ? 0 : c.tipo === 'dinheiro' ? 1 : 2);
  const conta = el('select', {}, [...contasPagamento].sort((a, b) => ordemConta(a) - ordemConta(b)).map((c) => el('option', { value: c.id }, nomeConta[c.id])));
  const local = el('select', {}, el('option', { value: '' }, 'Sem local específico'), locais.map((l) => el('option', { value: l.id }, l.nome)));
  const favorecido = el('input', { maxlength: '80', placeholder: 'Ex.: Thiago' });
  const blocoFavorecido = el('label', { class: 'escondido' }, 'A pagar para (pessoa)', favorecido);
  const pagador = el('select', {}, Object.entries(nomePessoa).map(([id, n]) => el('option', { value: id, selected: id === usuario.id }, n)));
  const prev = el('input', { type: 'checkbox' });
  prev.addEventListener('change', () => blocoFavorecido.classList.toggle('escondido', !prev.checked));
  const obs = el('textarea', { rows: '2', maxlength: '500', placeholder: 'Opcional' });
  const erro = el('p', { class: 'erro', role: 'alert' });
  const blocoCot = el('label', { class: 'escondido' }, 'Cotação (R$ por 1)', cot);

  const atualizarPrevia = () => {
    const v = lerNumero(valor.value); const c = moeda.value === 'BRL' ? 1 : lerNumero(cot.value);
    previa.textContent = v && c ? `≈ ${reais(Math.round(v * c * 100))}` : '';
  };
  const aoTrocarMoeda = async () => {
    if (moeda.value === 'BRL') { blocoCot.classList.add('escondido'); atualizarPrevia(); return; }
    blocoCot.classList.remove('escondido');
    cot.placeholder = 'Buscando cotação…';
    const c = await buscarCotacao(moeda.value);
    if (c) { cot.value = String(c.valor.toFixed(4)).replace('.', ','); cot.placeholder = 'R$ por 1 unidade'; previa.dataset.fonte = `cotação de ${c.data}`; }
    else { cot.placeholder = 'Digite a cotação'; }
    atualizarPrevia();
  };
  moeda.addEventListener('change', aoTrocarMoeda);
  valor.addEventListener('input', atualizarPrevia); cot.addEventListener('input', atualizarPrevia);

  const botao = el('button', { type: 'submit' }, 'Salvar gasto');
  const form = el('form', { class: 'cartao tela escondido', onsubmit: async (e) => {
    e.preventDefault(); erro.textContent = '';
    const v = lerNumero(valor.value); const c = moeda.value === 'BRL' ? 1 : lerNumero(cot.value);
    if (!v) { erro.textContent = 'Digite o valor.'; return; }
    if (!c) { erro.textContent = 'Digite a cotação.'; return; }
    const status = prev.checked ? 'previsto' : 'confirmado';
    if (status === 'confirmado' && !conta.value) { erro.textContent = 'Cadastre uma conta, ou marque como previsão.'; return; }
    const centavos = Math.round(v * c * 100);
    botao.disabled = true;
    const { error } = await supabase.from('lancamentos').insert({
      espaco_id: espacoId, tipo: 'despesa', status,
      descricao: desc.value.trim(), valor_centavos: centavos, valor_previsto_centavos: status === 'previsto' ? centavos : null,
      data: data.value, data_competencia: competencia(data.value),
      categoria_id: catViagem, conta_id: conta.value || null,
      projeto_id: projetoId, rubrica_id: rub.value || null, local_id: local.value || null,
      favorecido: prev.checked && favorecido.value.trim() ? favorecido.value.trim() : null,
      moeda: moeda.value, valor_original: moeda.value === 'BRL' ? null : v, cotacao: moeda.value === 'BRL' ? null : c,
      pago_por: pagador.value || usuario.id, observacao: obs.value.trim() || null, origem: 'app',
    });
    botao.disabled = false;
    if (error) { erro.textContent = mensagemErro(error); return; }
    recarregar();
  } },
    el('div', { class: 'grade-valor' }, el('label', {}, 'Valor', valor), el('label', {}, 'Moeda', moeda)),
    blocoCot, previa,
    el('label', {}, 'Descrição', desc),
    el('label', {}, 'Data', data),
    el('label', {}, 'Item do orçamento', rub),
    el('label', {}, 'Local', local),
    contasPagamento.length ? el('label', {}, 'De onde saiu o dinheiro', conta) : el('p', { class: 'discreto' }, 'Ainda não há conta; o gasto pode ficar como previsão.'),
    el('label', {}, 'Quem pagou', pagador),
    el('label', { class: 'marcar' }, prev, 'Ainda não foi pago (previsão ou dívida com alguém)'),
    blocoFavorecido,
    el('label', {}, 'Observação', obs),
    erro, botao,
  );
  if ((proj.moedas || []).length > 1) {
    const local = proj.moedas.find((m) => m !== 'BRL');
    moeda.value = local; aoTrocarMoeda();
  }

  const datas = proj.data_inicio ? `${dataCurta(proj.data_inicio)}${proj.data_fim ? ` a ${dataCurta(proj.data_fim)}` : ''}` : null;
  mostrar(el('section', { class: 'tela' },
    marca(),
    el('a', { class: 'link', href: ehEspacoViagem ? '#/' : `#/espaco/${espacoId}` }, ehEspacoViagem ? '‹ Seus espaços' : `‹ ${espR.data.nome}`),
    el('h1', {}, proj.nome),
    datas && el('p', { class: 'discreto' }, `${datas} · toque no dia para ver e lançar`),
    (proj.moedas || []).some((m) => m !== 'BRL') && el('a', { class: 'botao-conversor', href: `/conversor.html?voltar=${encodeURIComponent(location.pathname + location.hash)}` },
      el('span', { 'aria-hidden': 'true' }, '💱'), el('span', {}, el('strong', {}, 'Quanto custa isso?'), el('span', { class: 'pequeno-texto' }, 'Converter moeda · funciona sem internet'))),
    roteiroDiaADia(lancs, (l) => itemLancamento(l, { nomeCat, nomeConta, contas: contasPagamento.map((c) => ({ ...c, nome: nomeConta[c.id] })), podeEditar, aoMudar: recarregar, nomePessoa, nomeRubrica, nomeLocal, compacto: true }), nomeLocal,
      podeEditar ? (d, localId, botao) => {
        data.value = d; if (localId) local.value = localId;
        form.classList.remove('escondido'); botao.after(form); valor.focus();
      } : null, proj.data_inicio, proj.data_fim),
    podeEditar && el('button', { class: 'secundario', onclick: (e) => { form.classList.toggle('escondido'); e.currentTarget.after(form); valor.focus(); } }, '+ Gasto em outra data'),
    podeEditar && form,
    el('h2', {}, 'Painel da viagem'),
    resumo,
    graficoEvolucao(despesas, proj.data_inicio, proj.data_fim),
    blocoRubricas,
    blocoLocais,
    blocoDevidos,
    blocoPessoas,
    blocoDinheiro,
    el('p', { class: 'discreto pequeno-texto' }, 'Quando a fatura do cartão chegar, use “Confirmar valor real” para acertar o valor em reais com IOF.'),
    ehEspacoViagem && el('div', { class: 'tela' },
      el('h2', {}, 'Contas da viagem'),
      contas.length ? el('ul', { class: 'lista' }, contas.map((c) => el('li', { class: 'cartao linha' }, el('span', {}, `${c.nome} · ${NOMES_CONTA[c.tipo] || c.tipo}`), el('strong', {}, reais(saldos[c.id])))))
        : el('p', { class: 'discreto' }, 'Ex.: “Wise” (Carteira digital) e “Dinheiro em espécie” (Dinheiro).'),
      podeEditar && formularioConta(espacoId, recarregar),
      podeEditar && editaveis.length >= 2 && formularioTransferencia(editaveis, recarregar, espacoId),
      el('h2', {}, 'Quem participa'),
      el('ul', { class: 'lista' }, membrosR.data.map((m) => el('li', { class: 'cartao linha' },
        el('span', {}, (m.perfis && m.perfis.nome) || 'Sem nome'), el('span', { class: 'etiqueta' }, NOMES_PAPEL[m.papel] || m.papel)))),
      papel === 'dono' && formularioConvite(espacoId, recarregar),
    ),
  ));
}

// ---------- roteamento ----------
async function rotear() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { usuario = null; return telaEmail(); }
  if (!usuario || usuario.id !== session.user.id || !usuario.nome) {
    const { data: perfil, error } = await supabase.from('perfis').select('id, nome').eq('id', session.user.id).single();
    if (error) return telaErro(`Não foi possível carregar seu perfil: ${mensagemErro(error)}`);
    usuario = perfil;
  }
  if (!usuario.nome) return telaNome();
  const m = location.hash.match(/^#\/espaco\/([0-9a-f-]{36})$/);
  if (m) return telaEspaco(m[1]);
  const me = location.hash.match(/^#\/extrato\/([0-9a-f-]{36})$/);
  if (me) return telaExtrato(me[1]);
  const mp = location.hash.match(/^#\/projeto\/([0-9a-f-]{36})$/);
  if (mp) return telaProjeto(mp[1]);
  return telaInicio();
}

window.addEventListener('hashchange', () => { estado.mes = mesAtual(); rotear(); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptInstalacao = e; });
supabase.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') { usuario = null; location.hash = ''; telaEmail(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// remove o token da barra de endereço se a pessoa entrou pelo link do e-mail
if (location.hash.includes('access_token')) {
  supabase.auth.getSession().then(() => { history.replaceState(null, '', location.pathname); rotear(); });
} else {
  rotear();
}
