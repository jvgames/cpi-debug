# Arquitetura de Endpoints — Revivificação Club Penguin Island (CPI)

> Blueprint baseado na topologia do debug menu (`Root -> Network -> {News, Game Server, Content, Web Services}` e `Web Services -> {Login, Login Part 2, Game, Account}`), adaptado para backend moderno com REST + WebSocket.

## Premissas gerais de arquitetura

- **Domínio principal (Network)** é um agregador técnico que expõe submódulos desacoplados.
- **Web Services** atua como **API Gateway/BFF** para o cliente mobile, roteando para Login, Conta e Jogo.
- **Game Server** mantém estado de sessão em tempo real (presença, salas, eventos multiplayer).
- **Content** fornece manifesto/versionamento e catálogos de conteúdo.
- **News** distribui anúncios dinâmicos e calendário de eventos.
- **Autenticação em duas etapas**:
  - **Login Parte 1**: valida credenciais e emite token temporário de desafio.
  - **Login Parte 2**: valida desafio/segundo fator e emite sessão completa (JWT + refresh).

---

## 1) Notícias (`news-service`)

### Propósito e responsabilidades

- Publicar notícias do jogo (patch notes, eventos sazonais, manutenção).
- Entregar conteúdo localizado em `pt-BR` com fallback em `en-US`.
- Sinalizar urgência (banner crítico) para cliente e gateway.

### Endpoints principais (REST)

- `GET /v1/news`
  - Lista notícias ativas por idioma e canal.
- `GET /v1/news/{id}`
  - Retorna notícia detalhada.
- `GET /v1/news/highlights`
  - Retorna destaques para home/login.
- `GET /v1/news/system-status`
  - Mensagem operacional (UP, manutenção, degradação).
- `POST /v1/news` *(admin)*
  - Cria notícia.
- `PATCH /v1/news/{id}` *(admin)*
  - Atualiza notícia.

### Exemplo requisição/resposta

`GET /v1/news?locale=pt-BR&channel=mobile&limit=5`

```json
{
  "items": [
    {
      "id": "news_2026_carnaval",
      "title": "Festival da Ilha começou!",
      "summary": "Ganhe moedas e itens exclusivos em mini games.",
      "category": "event",
      "priority": "high",
      "publishedAt": "2026-02-22T18:00:00Z",
      "expiresAt": "2026-03-10T03:00:00Z",
      "locale": "pt-BR"
    }
  ],
  "nextCursor": "eyJvZmZzZXQiOjV9"
}
```

### Dependências com outros módulos

- **Content**: imagens/banners de notícias.
- **Web Services**: agregação para tela inicial.
- **Game Server**: uso indireto para anunciar eventos de gameplay.

### Autenticação/autorização

- Leitura pública (com rate limit).
- Escrita somente com `Bearer` + escopo `news:write`.

### Fluxo de dados esperado

1. Cliente chama `Web Services` para bootstrap.
2. Gateway consulta `news-service`.
3. Cliente renderiza cards e banner urgente.

---

## 2) Servidor do Jogo (`game-server-service`)

### Propósito e responsabilidades

- Gerenciar sessões de jogo em tempo real.
- Controlar salas/shards, presença, matchmaking e sincronização de estado leve.
- Processar comandos de gameplay com validação anti-cheat no servidor.

### Endpoints principais

#### REST (controle)

- `POST /v1/sessions/open`
  - Abre sessão de jogo vinculada ao usuário autenticado.
- `POST /v1/sessions/{sessionId}/close`
  - Fecha sessão e persiste estado final.
- `GET /v1/realms`
  - Lista realms disponíveis e lotação.
- `POST /v1/realms/{realmId}/join`
  - Reserva entrada em realm/sala.

#### WebSocket (tempo real)

- `WS /v1/realtime/connect?sessionToken=...`
  - Canal bidirecional para movimento, presença e eventos.

Eventos sugeridos:
- `player.move`
- `player.emote`
- `zone.enter`
- `party.invite`
- `server.snapshot`
- `server.kick`

### Exemplo requisição/resposta

`POST /v1/sessions/open`

```json
{
  "clientVersion": "1.0.0-revival",
  "platform": "android",
  "region": "sa-east-1"
}
```

```json
{
  "sessionId": "sess_4f2c",
  "sessionToken": "gst_eyJhbGciOi...",
  "realtimeUrl": "wss://game.cpi-revival.net/v1/realtime/connect",
  "expiresIn": 3600
}
```

### Dependências com outros módulos

- **Login Parte 2**: valida tokens de sessão.
- **Account**: carrega perfil/inventário base.
- **Content**: configuração de zonas, regras e tabelas de recompensa.
- **Game**: APIs de ações persistentes (missões, recompensas).

### Autenticação/autorização

- Requer `access_token` válido + `sessionToken` efêmero para WS.
- Autorização por realm (idade/região/estado da conta, se aplicável).

### Fluxo de dados esperado

1. Cliente autenticado abre sessão.
2. Recebe endpoint WS + token de curta duração.
3. Publica ações em tempo real; servidor responde snapshots/eventos.
4. Na saída, sincroniza progresso com `Game`/`Account`.

---

## 3) Conteúdo (`content-service`)

### Propósito e responsabilidades

- Distribuir metadados de assets (manifestos, catálogos, tabelas de balanceamento).
- Fornecer controle de versão e rollout por canal/plataforma.
- Expor hash/checksum para validação de integridade.

### Endpoints principais (REST/CDN-aware)

- `GET /v1/content/manifest`
  - Manifesto principal com versões dos pacotes.
- `GET /v1/content/bundles/{bundleId}`
  - Metadados de bundle (URL CDN, hash, tamanho).
- `GET /v1/content/catalogs/{catalogName}`
  - Catálogos de itens, missões, NPCs, etc.
- `GET /v1/content/config/runtime`
  - Flags e configs dinâmicas (feature toggles).
- `POST /v1/content/invalidate` *(admin)*
  - Invalida cache de conteúdo.

### Exemplo requisição/resposta

`GET /v1/content/manifest?platform=android&locale=pt-BR&client=1.0.0-revival`

```json
{
  "manifestVersion": "2026.02.22.1",
  "minimumClientVersion": "1.0.0-revival",
  "bundles": [
    {
      "bundleId": "ui_ptbr",
      "url": "https://cdn.cpi-revival.net/bundles/ui_ptbr_2026_02_22",
      "sha256": "9d2f...",
      "sizeBytes": 10485760
    }
  ],
  "runtimeConfig": {
    "doubleLoginEnabled": true,
    "season": "festival_ilha"
  }
}
```

### Dependências com outros módulos

- **News**: referencia assets de anúncios.
- **Game Server/Game**: consomem tabelas de regras e eventos.
- **Web Services**: agrega manifesto no bootstrap inicial.

### Autenticação/autorização

- Leitura majoritariamente pública (com assinatura opcional de URL).
- Operações administrativas exigem escopo `content:admin`.

### Fluxo de dados esperado

1. Cliente consulta manifesto ao iniciar.
2. Baixa bundles via CDN.
3. Game Server usa configs para validar regras em runtime.

---

## 4) Web Services (`web-services-gateway`)

### Propósito e responsabilidades

- Ponto de entrada unificado para o app mobile.
- Orquestrar chamadas de Login, Account, Game e módulos de Network.
- Normalizar contratos, rate limit, observabilidade e tratamento de erro.

### Endpoints principais (BFF/Gateway)

- `GET /v1/bootstrap`
  - Retorna payload agregado inicial (news + manifest + status).
- `POST /v1/auth/login`
  - Proxy para Login Parte 1.
- `POST /v1/auth/verify`
  - Proxy para Login Parte 2.
- `GET /v1/me`
  - Agrega perfil + estado de sessão.
- `GET /v1/game/startup`
  - Dados iniciais para entrar no mundo.
- `GET /v1/health/dependencies`
  - Saúde das integrações internas.

### Exemplo requisição/resposta

`GET /v1/bootstrap?locale=pt-BR&platform=android`

```json
{
  "system": {
    "status": "UP",
    "message": "Servidores estáveis"
  },
  "newsHighlights": [
    { "id": "news_2026_carnaval", "title": "Festival da Ilha começou!" }
  ],
  "content": {
    "manifestVersion": "2026.02.22.1",
    "minimumClientVersion": "1.0.0-revival"
  },
  "auth": {
    "doubleStepLogin": true
  }
}
```

### Dependências com outros módulos

- **News, Content, Login, Login Parte 2, Game, Account** (núcleo de orquestração).
- **Game Server** via `game/startup` para dados de conexão real-time.

### Autenticação/autorização

- Endpoints públicos: `bootstrap`, `auth/*`, `health` (interno/restrito por IP).
- Endpoints privados: JWT obrigatório + escopos mínimos por rota.

### Fluxo de dados esperado

1. Cliente chama `bootstrap`.
2. Faz `auth/login` e `auth/verify`.
3. Com token, obtém `me` e `game/startup`.
4. Conecta no `Game Server` em WS.

---

## 5) Login (Parte 1) (`auth-login-service`)

### Propósito e responsabilidades

- Validar identidade inicial (usuário/senha, token social, device attestation).
- Aplicar anti-abuso (rate limit, fingerprint, reputação de IP).
- Emitir `challenge_token` temporário para segunda etapa.

### Endpoints principais (REST)

- `POST /v1/login/start`
  - Inicia autenticação primária.
- `POST /v1/login/password`
  - Valida credencial clássica.
- `POST /v1/login/social`
  - Valida login externo (Apple/Google, se usado no revival).
- `POST /v1/login/device-check`
  - Avalia integridade do dispositivo.

### Exemplo requisição/resposta

`POST /v1/login/password`

```json
{
  "username": "pinguim123",
  "password": "********",
  "deviceId": "a1b2c3d4",
  "locale": "pt-BR"
}
```

```json
{
  "challengeToken": "chl_eyJhbGciOi...",
  "challengeType": "pin",
  "expiresIn": 300,
  "loginTransactionId": "ltx_9b31"
}
```

### Dependências com outros módulos

- **Account**: busca conta e status (banida, bloqueada, menoridade).
- **Login Parte 2**: encaminha `loginTransactionId` e contexto de risco.
- **Web Services**: consumo via gateway.

### Autenticação/autorização

- Público (sem JWT), porém protegido por rate limit + captcha/invisible challenge.

### Fluxo de dados esperado

1. Cliente envia credenciais.
2. Serviço valida e cria transação de login.
3. Retorna desafio para conclusão na Parte 2.

---

## 6) Login (Parte 2) (`auth-verify-service`)

### Propósito e responsabilidades

- Validar segundo fator/desafio (PIN, OTP, código do dispositivo, confirmação parental).
- Finalizar autenticação e emitir tokens de sessão.
- Registrar trilha de auditoria de login.

### Endpoints principais (REST)

- `POST /v1/login/verify`
  - Valida desafio e finaliza login.
- `POST /v1/login/refresh`
  - Renova `access_token` usando `refresh_token`.
- `POST /v1/login/logout`
  - Revoga sessão atual.
- `POST /v1/login/logout-all`
  - Revoga todas as sessões do usuário.

### Exemplo requisição/resposta

`POST /v1/login/verify`

```json
{
  "loginTransactionId": "ltx_9b31",
  "challengeToken": "chl_eyJhbGciOi...",
  "verificationCode": "0000",
  "deviceId": "a1b2c3d4"
}
```

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "rfr_eyJhbGciOi...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "accountId": "acc_1029",
  "scopes": ["account:read", "game:play"]
}
```

### Dependências com outros módulos

- **Login Parte 1**: recebe contexto do desafio.
- **Account**: valida elegibilidade final da conta.
- **Game Server**: tokens usados para abrir sessão de jogo.
- **Web Services**: exposto ao cliente via gateway.

### Autenticação/autorização

- `verify` é semi-público (requer artefatos do passo 1).
- `refresh/logout` exigem token válido.

### Fluxo de dados esperado

1. Cliente envia código da etapa 2.
2. Serviço valida e emite JWT + refresh.
3. Cliente usa JWT nos módulos Account/Game/Game Server.

---

## 7) Jogo (`game-api-service`)

### Propósito e responsabilidades

- APIs de estado persistente de gameplay (missões, recompensas, progressão).
- Operações transacionais que não devem depender só de WS.
- Coordenação de regras de negócio com inventário/economia.

### Endpoints principais (REST)

- `GET /v1/game/state`
  - Estado consolidado do jogador para sessão atual.
- `POST /v1/game/actions/complete-mission`
  - Marca missão como concluída.
- `POST /v1/game/actions/claim-reward`
  - Resgata recompensa.
- `GET /v1/game/events/active`
  - Eventos ativos e multiplicadores.
- `POST /v1/game/minigames/{id}/result`
  - Envia resultado de mini game com validação.

### Endpoints complementares (WS bridge opcional)

- `WS /v1/game/events/stream`
  - Notificações de progresso persistente (alternativa ao polling).

### Exemplo requisição/resposta

`POST /v1/game/actions/claim-reward`

```json
{
  "rewardId": "rw_event_2026_01",
  "source": "mission",
  "idempotencyKey": "42f1d901-a1cd-4472"
}
```

```json
{
  "status": "claimed",
  "grantedItems": [
    { "itemId": "shirt_carnaval_azul", "quantity": 1 }
  ],
  "wallet": {
    "coins": 12450
  },
  "appliedAt": "2026-02-22T18:25:00Z"
}
```

### Dependências com outros módulos

- **Account**: inventário/carteira/perfil.
- **Content**: definição de recompensas e tabelas.
- **Game Server**: recebe eventos em tempo real e consolida persistência.
- **Web Services**: exposição unificada ao cliente.

### Autenticação/autorização

- JWT obrigatório; escopos como `game:play`, `game:reward:claim`.
- Idempotência obrigatória em endpoints financeiros/recompensa.

### Fluxo de dados esperado

1. Cliente joga em tempo real no Game Server.
2. Marcos de progresso persistente são enviados ao `game-api-service`.
3. Resultado atualiza conta e retorna estado consistente.

---

## 8) Conta (`account-service`)

### Propósito e responsabilidades

- Fonte de verdade de identidade do jogador (perfil, configurações, inventário, moeda).
- Gerenciar preferências e segurança da conta.
- Sincronizar dados cross-device.

### Endpoints principais (REST)

- `GET /v1/account/me`
  - Dados completos da conta autenticada.
- `PATCH /v1/account/me/profile`
  - Atualiza apelido, avatar, preferências visuais.
- `GET /v1/account/me/inventory`
  - Lista itens e cosméticos.
- `GET /v1/account/me/wallet`
  - Moedas/saldos.
- `POST /v1/account/me/settings`
  - Atualiza configurações (som, controles, idioma).
- `GET /v1/account/me/sync`
  - Delta de sincronização para cliente.

### Exemplo requisição/resposta

`GET /v1/account/me`

```json
{
  "accountId": "acc_1029",
  "displayName": "PinguimExplorador",
  "locale": "pt-BR",
  "createdAt": "2026-01-10T12:00:00Z",
  "profile": {
    "avatarId": "avt_blue_01",
    "level": 14,
    "xp": 9820
  },
  "safety": {
    "chatMode": "safe",
    "parentalControls": true
  }
}
```

### Dependências com outros módulos

- **Login Parte 1/2**: valida status de conta durante autenticação.
- **Game**: leitura/escrita de inventário e progressão.
- **Game Server**: hidrata sessão com snapshot da conta.
- **Web Services**: agregação para `/me` e bootstrap pós-login.

### Autenticação/autorização

- JWT obrigatório em todas as rotas de usuário.
- Operações sensíveis exigem step-up auth (reautenticação recente).

### Fluxo de dados esperado

1. Após login duplo, cliente consulta `/account/me`.
2. Durante gameplay, `Game` e `Game Server` atualizam dados da conta.
3. Cliente faz sync incremental ao reabrir app/dispositivo.

---

## Fluxo fim-a-fim recomendado (resumo de implementação)

1. **Bootstrap**: app chama `Web Services /bootstrap` para obter status, notícias e manifesto.
2. **Login Parte 1**: credencial primária gera `challengeToken`.
3. **Login Parte 2**: verificação gera `accessToken` + `refreshToken`.
4. **Hidratação**: app busca `Account /me` e `Game /state`.
5. **Sessão real-time**: app abre sessão no `Game Server` e conecta em WS.
6. **Persistência**: eventos de progresso são consolidados em `Game` e refletidos em `Account`.
7. **Conteúdo/Notícias**: atualizações periódicas via `Content` e `News` sem necessidade de update binário.

## Convenções operacionais recomendadas

- Versionamento de API: `/v1` em todos os serviços.
- Correlação distribuída: header `X-Request-Id` e `X-Session-Id`.
- Formato de erro padrão:

```json
{
  "error": {
    "code": "AUTH_CHALLENGE_INVALID",
    "message": "Código de verificação inválido.",
    "details": null,
    "requestId": "req_8f31"
  }
}
```

- Observabilidade mínima:
  - tracing (OpenTelemetry), métricas de latência p95/p99, taxa de erro por endpoint.
  - auditoria forte em autenticação, compra/recompensa e mudanças de conta.
