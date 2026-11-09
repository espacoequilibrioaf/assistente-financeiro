# Assistente Financeiro

Controle financeiro de uso interno: pessoal, da família e das empresas (doPontoAparaB e Espaço Equilíbrio AF).
Um app web instalável no celular (PWA), com o banco de dados no Supabase. Custo atual: R$ 0.

## Como está organizado

| Arquivo | Para que serve |
| --- | --- |
| `index.html` | Página única do app |
| `app.js` | Telas e lógica (login, perfil, espaços) |
| `config.js` | Endereço do Supabase e chave pública (feita para ficar no app) |
| `style.css` | Visual (claro e escuro automáticos) |
| `manifest.webmanifest`, `sw.js`, `icons/` | O que faz o site virar app instalável |
| `_headers` | Regras de segurança do navegador (Cloudflare Pages) |

Não há etapa de compilação: os arquivos são publicados como estão.

## Banco de dados (Supabase, projeto `assistente-financeiro`, São Paulo)

- **Espaços**: cada lançamento pertence a um espaço (pessoal, família ou empresa). Cada pessoa ganha um espaço pessoal ao se cadastrar.
- **Isolamento (RLS)**: uma pessoa só lê o que é dos espaços em que participa. Testado com 16 cenários em 09/11/2026.
- **Nada é apagado**: lançamentos são cancelados, e toda alteração vai para `historico_alteracoes`.
- **Dinheiro em centavos inteiros** (R$ 15,00 = 1500).
- Estruturas já criadas para as próximas fases: contas, cartões, faturas, parcelas, previsto × realizado, planejamento anual com revisões, recorrências e metas.

## Publicação

Cloudflare Pages ligado a este repositório (branch `main`), sem comando de build e com pasta de saída `/`.

## Fases

- [x] Fase 0a: banco de dados, isolamento e testes
- [ ] Fase 0b: app instalável com login por código no e-mail
- [ ] Fase 1: contas, cartões, lançamentos, previsto × realizado, planejamento anual, viagens e projetos
- [ ] Fase 3: WhatsApp (por regras, sem IA)
- [ ] Depois: IA (áudio, foto, perguntas livres)
