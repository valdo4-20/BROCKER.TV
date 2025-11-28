BROCKER.TV — Painel de Transmissão (Frontend + Backend)

Resumo

Este repositório contém um painel de transmissão minimalista chamado BROCKER.TV. Ele inclui:

- Frontend: `index.html`, `style.css`, `app.js` — interface de transmissão, preview, mixer, perfil e integração com provedores.
- Backend: `server.js` — Node.js + Express com SQLite (via `sql.js`) para persistência de contas, sessões e métricas; endpoints OAuth para Twitch, Google/YouTube e Steam.

Rápido início

1) Copie variáveis de ambiente para `.env` na raiz do projeto:

```
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
BASE_URL=http://localhost:3000
JWT_SECRET=uma_chave_forte_aqui
PORT=3000
```

2) Instale dependências e rode o servidor:

```powershell
npm install
npm start
```

3) Abra `index.html` no navegador (ex: http://localhost:3000/index.html se você servir os arquivos estáticos). O frontend tentará detectar sessão via `/api/me`.

OAuth Redirect URIs (exemplos que você deve registrar nos consoles de desenvolvedor):

- Local dev (localhost:3000):
  - http://localhost:3000/auth/twitch/callback
  - http://localhost:3000/auth/youtube/callback
  - http://localhost:3000/auth/google/callback
  - http://localhost:3000/auth/steam/callback

- Produção (exemplo):
  - https://app.seudominio.com/auth/twitch/callback
  - https://app.seudominio.com/auth/youtube/callback
  - https://app.seudominio.com/auth/google/callback
  - https://app.seudominio.com/auth/steam/callback

Próximos passos recomendados

- Trocar cookies para `secure: true` em produção e usar HTTPS.
- Configurar refresh token flow seguro e rotacionamento quando usar provedores que retornam refresh tokens.
- Proteger endpoints com `authMiddleware` onde apropriado.
- Substituir polling por webhooks (Twitch EventSub) para métricas em produção.

Se quiser, eu posso:
- Atualizar todos os textos restantes no frontend e backend para usar BROCKER.TV (já atualizei os principais).
- Aplicar `authMiddleware` a endpoints sensíveis.
- Integrar as credenciais que você fornecer e testar fluxos OAuth completos.
