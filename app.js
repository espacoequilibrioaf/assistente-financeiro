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
  const mes = estado.mes;
  const [espR, papelR, contasR, mesR, saldosR, membrosR, anoR] = await Promise.all([
    supabase.from('espacos').select('id, nome, tipo').eq('id', espacoId).single(),
    supabase.from('membros_espaco').select('papel').eq('espaco_id', espacoId).eq('usuario_id', usuario.id).single(),
    supabase.from('contas').select('id, nome, tipo, saldo_inicial_centavos').eq('espaco_id', espacoId).eq('ativa', true).order('nome'),
    supabase.from('lancamentos')
      .select('id, tipo, status, descricao, observacao, valor_centavos, valor_previsto_centavos, data, categoria_id, conta_id')
      .eq('espaco_id', espacoId).eq('data_competencia', `${mes}-01`).neq('status', 'cancelado')
      .order('data', { ascending: false }).order('criado_em', { ascending: false }),
    supabase.from('lancamentos').select('conta_id, tipo, valor_centavos').eq('espaco_id', espacoId).eq('status', 'confirmado'),
    supabase.from('membros_espaco').select('papel, usuario_id, perfis ( nome )').eq('espaco_id', espacoId),
    supabase.from('lancamentos').select('tipo, status, descricao, valor_centavos, data, data_competencia')
      .eq('espaco_id', espacoId).neq('status', 'cancelado').in('tipo', ['receita', 'despesa'])
      .gte('data_competencia', `${mesAtual()}-01`).lte('data_competencia', `${somarMes(mesAtual(), 11)}-01`),
  ]);
  const erro = [espR, papelR, contasR, mesR, saldosR, membrosR, anoR].find((r) => r.error);
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
  const saldo = Object.fromEntries(contas.map((c) => [c.id, c.saldo_inicial_centavos]));
  for (const l of saldosR.data) {
    if (!(l.conta_id in saldo)) continue;
    if (l.tipo === 'receita') saldo[l.conta_id] += l.valor_centavos;
    if (l.tipo === 'despesa') saldo[l.conta_id] -= l.valor_centavos;
  }
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
    el('h2', {}, 'Lançamentos do mês'), lista,
    painel.meses,
    blocoContas, blocoMembros,
  ));
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
  const W = 340, H = 150, base = 128, larg = W / 12;
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
    add('text', { x: x + larg / 2, y: H - 6, class: 'rotulo', 'text-anchor': 'middle' }, abrev(p.m));
  });
  const tabela = el('details', {}, el('summary', {}, 'Ver em tabela'),
    el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Mês'), el('th', {}, 'Entra'), el('th', {}, 'Sai'), el('th', {}, 'Sobra'))),
      el('tbody', {}, porMes.map((p) => el('tr', {}, el('td', {}, abrev(p.m)), el('td', {}, reais(p.entra)), el('td', {}, reais(p.sai)), el('td', { class: p.entra - p.sai < 0 ? 'negativo' : '' }, reais(p.entra - p.sai))))),
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
    l.observacao ? el('p', { class: 'observacao' }, l.observacao) : null,
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
supabase.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') { usuario = null; location.hash = ''; telaEmail(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// remove o token da barra de endereço se a pessoa entrou pelo link do e-mail
if (location.hash.includes('access_token')) {
  supabase.auth.getSession().then(() => { history.replaceState(null, '', location.pathname); rotear(); });
} else {
  rotear();
}
