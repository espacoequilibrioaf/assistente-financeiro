// Assistente Financeiro — fase 0: login por código no e-mail, perfil e lista de espaços.
// Sem etapa de build: o navegador carrega a biblioteca do Supabase direto do esm.sh.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG } from './config.js';

const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const app = document.getElementById('app');
let promptInstalacao = null;

// ---------- utilitários de tela ----------
function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
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
  const foco = app.querySelector('input');
  if (foco) foco.focus();
}

function mensagemErro(erro) {
  const msg = (erro && (erro.message || String(erro))) || 'Erro desconhecido';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
  if (/expired|invalid/i.test(msg)) return 'Código inválido ou vencido. Peça um novo código.';
  if (/fetch|network/i.test(msg)) return 'Sem conexão com a internet. Tente de novo.';
  return msg;
}

const NOMES_TIPO = { pessoal: 'Pessoal', familia: 'Família', empresa: 'Empresa' };
const NOMES_PAPEL = { dono: 'dono', editor: 'pode editar', leitor: 'só leitura', dependente: 'dependente' };

// ---------- telas ----------
function telaEmail(erro = '') {
  const input = el('input', { type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', required: true, placeholder: 'voce@exemplo.com' });
  const botao = el('button', { type: 'submit' }, 'Enviar código');
  const form = el('form', { class: 'tela', onsubmit: async (e) => {
    e.preventDefault();
    const email = input.value.trim().toLowerCase();
    if (!email) return;
    botao.disabled = true; botao.textContent = 'Enviando…';
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
    });
    if (error) return telaEmail(mensagemErro(error));
    telaCodigo(email);
  } },
    el('p', { class: 'marca' }, 'Assistente Financeiro'),
    el('h1', {}, 'Entrar'),
    el('p', { class: 'discreto' }, 'Digite seu e-mail. Vamos mandar um código para você entrar, sem senha.'),
    el('label', {}, 'E-mail', input),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    botao,
  );
  mostrar(el('section', { class: 'centro tela' }, form));
}

function telaCodigo(email, erro = '') {
  const input = el('input', { class: 'codigo', name: 'codigo', autocomplete: 'one-time-code', inputmode: 'numeric', pattern: '[0-9]{6,10}', maxlength: '10', required: true, placeholder: '000000' });
  const botao = el('button', { type: 'submit' }, 'Entrar');
  const form = el('form', { class: 'tela', onsubmit: async (e) => {
    e.preventDefault();
    const token = input.value.replace(/\D/g, '');
    if (token.length < 6) return telaCodigo(email, 'O código tem pelo menos 6 números.');
    botao.disabled = true; botao.textContent = 'Conferindo…';
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) return telaCodigo(email, mensagemErro(error));
    await carregar();
  } },
    el('h1', {}, 'Digite o código'),
    el('p', { class: 'discreto' }, `Enviamos um código para ${email}. Confira também a caixa de spam.`),
    el('label', {}, 'Código', input),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    botao,
    el('button', { type: 'button', class: 'link', onclick: () => telaEmail() }, 'Usar outro e-mail ou pedir novo código'),
  );
  mostrar(el('section', { class: 'centro tela' }, form));
}

function telaNome(usuarioId, erro = '') {
  const input = el('input', { name: 'nome', autocomplete: 'given-name', required: true, maxlength: '60', placeholder: 'Seu nome' });
  const botao = el('button', { type: 'submit' }, 'Continuar');
  const form = el('form', { class: 'tela', onsubmit: async (e) => {
    e.preventDefault();
    const nome = input.value.trim();
    if (!nome) return;
    botao.disabled = true;
    const { error } = await supabase.from('perfis').update({ nome }).eq('id', usuarioId);
    if (error) return telaNome(usuarioId, mensagemErro(error));
    await carregar();
  } },
    el('h1', {}, 'Como podemos te chamar?'),
    el('label', {}, 'Nome', input),
    erro && el('p', { class: 'erro', role: 'alert' }, erro),
    botao,
  );
  mostrar(el('section', { class: 'centro tela' }, form));
}

function telaInicio(perfil, espacos) {
  const lista = el('ul', { class: 'lista' },
    espacos.map((e) => el('li', { class: 'cartao' },
      el('div', { class: 'linha' },
        el('strong', {}, e.nome),
        el('span', { class: 'etiqueta' }, NOMES_TIPO[e.tipo] || e.tipo),
      ),
      el('p', { class: 'discreto' }, `Você: ${NOMES_PAPEL[e.papel] || e.papel}`),
    )),
  );

  const instalar = promptInstalacao && el('button', { class: 'secundario', onclick: async () => {
    promptInstalacao.prompt();
    await promptInstalacao.userChoice;
    promptInstalacao = null;
    carregar();
  } }, 'Instalar o app no celular');

  const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;

  mostrar(el('section', { class: 'tela' },
    el('p', { class: 'marca' }, 'Assistente Financeiro'),
    el('h1', {}, `Olá, ${perfil.nome}!`),
    el('h2', {}, 'Seus espaços'),
    lista,
    el('div', { class: 'cartao' },
      el('strong', {}, 'Em construção'),
      el('ul', { class: 'passos' },
        el('li', {}, 'Contas, cartões e lançamentos'),
        el('li', {}, 'Previsto × realizado e planejamento anual'),
        el('li', {}, 'Viagens e projetos'),
      ),
    ),
    instalar,
    ehIOS && el('p', { class: 'discreto' }, 'No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.'),
    el('button', { class: 'secundario', onclick: async () => { await supabase.auth.signOut(); telaEmail(); } }, 'Sair'),
  ));
}

// ---------- fluxo principal ----------
async function carregar() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return telaEmail();
  const usuarioId = session.user.id;

  const { data: perfil, error: erroPerfil } = await supabase.from('perfis').select('id, nome').eq('id', usuarioId).single();
  if (erroPerfil) {
    return mostrar(el('section', { class: 'centro tela' },
      el('p', { class: 'erro' }, `Não foi possível carregar seu perfil: ${mensagemErro(erroPerfil)}`),
      el('button', { onclick: carregar }, 'Tentar de novo'),
    ));
  }
  if (!perfil.nome) return telaNome(usuarioId);

  const { data: membros, error: erroEspacos } = await supabase
    .from('membros_espaco')
    .select('papel, espacos ( id, nome, tipo )')
    .eq('usuario_id', usuarioId);
  if (erroEspacos) {
    return mostrar(el('section', { class: 'centro tela' },
      el('p', { class: 'erro' }, `Não foi possível carregar seus espaços: ${mensagemErro(erroEspacos)}`),
      el('button', { onclick: carregar }, 'Tentar de novo'),
    ));
  }
  const ordem = { pessoal: 0, familia: 1, empresa: 2 };
  const espacos = membros
    .filter((m) => m.espacos)
    .map((m) => ({ ...m.espacos, papel: m.papel }))
    .sort((a, b) => (ordem[a.tipo] - ordem[b.tipo]) || a.nome.localeCompare(b.nome, 'pt-BR'));
  telaInicio(perfil, espacos);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptInstalacao = e;
});

supabase.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT') telaEmail();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

carregar();
