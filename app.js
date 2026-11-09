// Assistente Financeiro — app web sem etapa de build.
// Telas: login por código, início (espaços), espaço (resumo do mês, lançamentos, contas, membros).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG } from './config.js';

const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const app = document.getElementById('app');
let promptInstalacao = null;
let usuario = null;          // { id, nome }
let categorias = null;       // cache das categorias padrão + do espaço
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

const NOMES_TIPO = { pessoal: 'Pessoal', familia: 'Família', empresa: 'Empresa' };
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
  const ordem = { pessoal: 0, familia: 1, empresa: 2 };
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
  const tipo = el('select', { name: 'tipo' }, el('option', { value: 'familia' }, 'Família'), el('option', { value: 'empresa' }, 'Empresa'));
  const erroCriar = el('p', { class: 'erro', role: 'alert' });
  const formCriar = el('form', { class: 'cartao tela escondido', onsubmit: async (e) => {
    e.preventDefault();
    if (!nome.value.trim()) return;
    const { data, error: erro } = await supabase.from('espacos')
      .insert({ nome: nome.value.trim(), tipo: tipo.value, criado_por: usuario.id }).select('id').single();
    if (erro) { erroCriar.textContent = mensagemErro(erro); return; }
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
async function carregarCategorias() {
  if (categorias) return categorias;
  const { data, error } = await supabase.from('categorias').select('id, nome, tipo, pai_id, ordem').eq('ativa', true);
  if (error) throw error;
  const pais = data.filter((c) => !c.pai_id).sort((a, b) => a.ordem - b.ordem);
  categorias = [];
  for (const p of pais) {
    categorias.push({ id: p.id, tipo: p.tipo, rotulo: p.nome });
    data.filter((c) => c.pai_id === p.id).sort((a, b) => a.ordem - b.ordem)
      .forEach((f) => categorias.push({ id: f.id, tipo: f.tipo, rotulo: `${p.nome} › ${f.nome}` }));
  }
  return categorias;
}

async function telaEspaco(espacoId) {
  const mes = estado.mes;
  const [espR, papelR, contasR, mesR, saldosR, membrosR] = await Promise.all([
    supabase.from('espacos').select('id, nome, tipo').eq('id', espacoId).single(),
    supabase.from('membros_espaco').select('papel').eq('espaco_id', espacoId).eq('usuario_id', usuario.id).single(),
    supabase.from('contas').select('id, nome, tipo, saldo_inicial_centavos').eq('espaco_id', espacoId).eq('ativa', true).order('nome'),
    supabase.from('lancamentos')
      .select('id, tipo, status, descricao, valor_centavos, valor_previsto_centavos, data, categoria_id, conta_id')
      .eq('espaco_id', espacoId).eq('data_competencia', `${mes}-01`).neq('status', 'cancelado')
      .order('data', { ascending: false }).order('criado_em', { ascending: false }),
    supabase.from('lancamentos').select('conta_id, tipo, valor_centavos').eq('espaco_id', espacoId).eq('status', 'confirmado'),
    supabase.from('membros_espaco').select('papel, usuario_id, perfis ( nome )').eq('espaco_id', espacoId),
  ]);
  const erro = [espR, papelR, contasR, mesR, saldosR, membrosR].find((r) => r.error);
  if (erro) return telaErro(`Não foi possível abrir este espaço: ${mensagemErro(erro.error)}`);
  let cats;
  try { cats = await carregarCategorias(); } catch (e) { return telaErro(mensagemErro(e)); }

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
  const saldo = Object.fromEntries(contas.map((c) => [c.id, c.saldo_inicial_centavos]));
  for (const l of saldosR.data) {
    if (!(l.conta_id in saldo)) continue;
    if (l.tipo === 'receita') saldo[l.conta_id] += l.valor_centavos;
    if (l.tipo === 'despesa') saldo[l.conta_id] -= l.valor_centavos;
  }
  const saldoTotal = Object.values(saldo).reduce((a, b) => a + b, 0);

  const recarregar = () => telaEspaco(espacoId);
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
          el('p', { class: 'discreto' }, NOMES_CONTA[c.tipo] || c.tipo))))
      : el('p', { class: 'discreto' }, 'Cadastre a primeira conta (banco, dinheiro ou carteira digital) para lançar o que já foi pago ou recebido.'),
    podeEditar && formularioConta(espacoId, recarregar),
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
    marca(), cabecalho, navMes, resumo, pendencias,
    (podeEditar || ehDependente) && formLanc,
    el('h2', {}, 'Lançamentos do mês'), lista,
    blocoContas, blocoMembros,
  ));
}

function formularioLancamento({ espacoId, contas, cats, podeEditar, ehDependente, aoSalvar }) {
  let tipoAtual = 'despesa';
  const valor = el('input', { inputmode: 'decimal', required: true, placeholder: '0,00', autocomplete: 'off' });
  const descricao = el('input', { maxlength: '120', placeholder: 'Ex.: coxinha da escola, mercado, salário' });
  const data = el('input', { type: 'date', required: true, value: hojeISO() });
  const categoria = el('select', {});
  const conta = el('select', {}, contas.map((c) => el('option', { value: c.id }, c.nome)));
  const previsto = el('input', { type: 'checkbox' });
  const erro = el('p', { class: 'erro', role: 'alert' });
  const botao = el('button', { type: 'submit' }, 'Salvar');

  const preencherCategorias = () => {
    categoria.replaceChildren(el('option', { value: '' }, 'Sem categoria'),
      cats.filter((c) => c.tipo === tipoAtual).map((c) => el('option', { value: c.id }, c.rotulo)));
  };
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
    !ehDependente && el('label', { class: 'marcar' }, previsto, 'É só uma previsão (ainda não foi pago ou recebido)'),
    ehDependente && el('p', { class: 'discreto' }, 'Seu lançamento vai para aprovação do responsável.'),
    erro, botao,
  );
  preencherCategorias();

  const abrir = el('button', { onclick: () => { form.classList.toggle('escondido'); valor.focus(); } }, '+ Novo lançamento');
  return el('div', { class: 'tela' }, abrir, form);
}

function itemLancamento(l, { nomeCat, nomeConta, contas, podeEditar, aoMudar }) {
  const sinal = l.tipo === 'receita' ? 'positivo' : 'negativo';
  const etiquetas = [];
  if (l.status === 'previsto') etiquetas.push(el('span', { class: 'etiqueta ouro' }, 'Previsto'));
  if (l.status === 'pendente_confirmacao') etiquetas.push(el('span', { class: 'etiqueta ouro' }, 'Aguardando aprovação'));
  const diferenca = l.status === 'confirmado' && l.valor_previsto_centavos && l.valor_previsto_centavos !== l.valor_centavos
    ? el('p', { class: 'discreto' }, `Previsto ${reais(l.valor_previsto_centavos)} · diferença ${reais(l.valor_centavos - l.valor_previsto_centavos)}`)
    : null;

  const acoes = el('div', { class: 'acoes' });
  const erro = el('p', { class: 'erro', role: 'alert' });
  if (podeEditar && (l.status === 'previsto' || l.status === 'pendente_confirmacao')) {
    const real = el('input', { inputmode: 'decimal', placeholder: 'Valor real', value: (l.valor_centavos / 100).toFixed(2).replace('.', ',') });
    const conta = el('select', {}, contas.map((c) => el('option', { value: c.id, selected: c.id === l.conta_id }, c.nome)));
    acoes.append(el('form', { class: 'confirmar', onsubmit: async (e) => {
      e.preventDefault();
      const centavos = lerValor(real.value);
      if (!centavos) { erro.textContent = 'Valor inválido.'; return; }
      if (!conta.value) { erro.textContent = 'Cadastre uma conta primeiro.'; return; }
      const { error } = await supabase.from('lancamentos').update({ status: 'confirmado', valor_centavos: centavos, conta_id: conta.value }).eq('id', l.id);
      if (error) { erro.textContent = mensagemErro(error); return; }
      aoMudar();
    } }, real, contas.length ? conta : null, el('button', { type: 'submit', class: 'pequeno' }, l.status === 'previsto' ? 'Confirmar valor real' : 'Aprovar')));
  }
  if (podeEditar) {
    acoes.append(el('button', { class: 'link pequeno', onclick: async () => {
      if (!confirm('Cancelar este lançamento? Ele sai das contas, mas continua no histórico.')) return;
      const { error } = await supabase.from('lancamentos').update({ status: 'cancelado' }).eq('id', l.id);
      if (error) { erro.textContent = mensagemErro(error); return; }
      aoMudar();
    } }, 'Cancelar lançamento'));
  }

  return el('li', { class: 'cartao' },
    el('div', { class: 'linha' },
      el('strong', {}, l.descricao || nomeCat[l.categoria_id] || (l.tipo === 'receita' ? 'Receita' : 'Despesa')),
      el('strong', { class: sinal }, (l.tipo === 'despesa' ? '− ' : '+ ') + reais(l.valor_centavos)),
    ),
    el('p', { class: 'discreto' }, [dataCurta(l.data), nomeCat[l.categoria_id], nomeConta[l.conta_id]].filter(Boolean).join(' · ')),
    etiquetas.length ? el('div', { class: 'acoes' }, etiquetas) : null,
    diferenca, acoes, erro,
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
  return telaInicio();
}

window.addEventListener('hashchange', () => { estado.mes = mesAtual(); rotear(); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptInstalacao = e; });
supabase.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') { usuario = null; categorias = null; location.hash = ''; telaEmail(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// remove o token da barra de endereço se a pessoa entrou pelo link do e-mail
if (location.hash.includes('access_token')) {
  supabase.auth.getSession().then(() => { history.replaceState(null, '', location.pathname); rotear(); });
} else {
  rotear();
}
