# Ajude Lavínia — Funil de doação com PIX (Duttyfy)

Site estático + 2 funções serverless da Vercel. Sem build, sem dependências pra instalar.

## Estrutura
```
index.html          → página inteira (front)
images/              → logo
api/create-pix.js    → gera a cobrança PIX (chama a Duttyfy)
api/status.js        → consulta se o PIX já foi pago
```

## Passo a passo pra publicar

### 1. Subir pro GitHub
1. Crie um repositório novo (ex: `juntospelavinha`)
2. Suba TODOS os arquivos dessa pasta (`index.html`, `images/`, `api/`, `README.md`) mantendo a mesma estrutura de pastas

### 2. Importar na Vercel
1. Na Vercel, **Add New → Project**
2. Selecione o repositório
3. **NÃO precisa mudar nenhuma configuração de build** — pode deixar tudo no padrão (Framework Preset: "Other")

### 3. Configurar a variável de ambiente (passo crítico)
Antes de fazer o deploy final (ou logo depois, e daí redeploy):

1. No projeto da Vercel → **Settings → Environment Variables**
2. Adicione:
   - **Name:** `DUTTYFY_PIX_URL`
   - **Value:** a URL criptografada completa que você pegou no painel da Duttyfy (Integrações e Chaves → API Keys → "Gerar URL Criptografada"), algo como:
     `https://www.pagamentos-seguros.app/api-pix/SEU_HASH_AQUI`
   - **Environment:** marque Production, Preview e Development
3. Salve e clique em **Redeploy** (variável de ambiente só entra em vigor depois de um novo deploy)

⚠️ Essa URL é a sua credencial de pagamento — nunca cole ela dentro do `index.html`, só nessa variável de ambiente da Vercel.

### 4. Testar
1. Abra o site publicado
2. Clique em "QUERO AJUDAR" → escolha um valor → "Contribuir agora"
3. Preencha e-mail, CPF e telefone → "Gerar PIX"
4. Deve aparecer o QR Code + código copia-e-cola
5. Pague um valor pequeno de teste pra confirmar que o polling de status funciona (a tela deve mudar sozinha pra "Doação confirmada!" depois do pagamento cair)

## Se algo der errado

- **"Gateway de pagamento não configurado"**: a variável `DUTTYFY_PIX_URL` não foi configurada ou o projeto não foi re-deployado depois de configurá-la.
- **PIX não gera / erro 400 ao clicar em "Gerar PIX"**: confira se o CPF tem 11 dígitos e o telefone tem DDD (10 ou 11 dígitos).
- **QR Code não aparece**: verifique se `cdnjs.cloudflare.com` não está bloqueado na rede de quem está testando (raro, mas acontece em redes corporativas).
- **Status nunca vira "COMPLETED"**: confirme com a Duttyfy se a URL criptografada ainda é válida (elas expiram/rotacionam às vezes — nesse caso gere uma nova no painel e atualize a variável de ambiente).

## TikTok Pixel + Events API (rastreamento de conversão)

O pixel já está no código (`D9IQGCRC77U84G6G8770`) e dispara sozinho:
- **InitiateCheckout** → quando o PIX é gerado
- **CompletePayment** → só quando o pagamento é confirmado (não no clique do botão)

Pra ativar também o reforço server-side (mais confiável contra bloqueador de anúncio e abas fechadas cedo demais):

1. Na Vercel → **Settings → Environment Variables**
2. Adicione:
   - **Name:** `TIKTOK_EVENTS_API_TOKEN`
   - **Value:** `8f6884a006b8db2832d937c1a5fd30eb748f950d`
   - **Environment:** Production e Preview
3. Redeploy

Sem essa variável configurada, o pixel client-side continua funcionando normalmente — só o reforço server-side fica desativado (sem quebrar nada). O `event_id` é o mesmo nos dois lados (pixel e Events API), então o TikTok deduplica automaticamente e não conta a mesma doação duas vezes.

### ⚠️ Passo crítico pra marcar TODAS as vendas (não só quando a pessoa fica na aba)

O pixel client-side só marca a venda se a pessoa ficar com o navegador aberto até a tela de confirmação. Na prática, a maioria paga pelo app do banco e não volta — por isso vendas reais ficavam sem marcar.

**Correção:** configurar o Webhook da Duttyfy, que avisa o servidor diretamente quando o PIX é pago, sem depender do navegador da pessoa.

1. No painel da Duttyfy → **Integrações e Chaves → Webhooks**
2. Cole a URL: `https://SEU-DOMINIO-NA-VERCEL.vercel.app/api/webhook-duttyfy`
   (troque pelo domínio real do seu projeto — pode ser o `.vercel.app` padrão ou seu domínio customizado)
3. Salve

Esse endpoint já reconfirma o pagamento direto com a Duttyfy antes de marcar qualquer venda (proteção extra, já que o webhook deles ainda não tem assinatura HMAC), e usa o mesmo `event_id` do pixel — então não corre risco de contar a mesma venda duas vezes, mesmo que os dois caminhos disparem.

## Sobre rastreamento (UTM)

O front já captura automaticamente todos os parâmetros da URL (utm_source, utm_medium, fbclid, etc.) e envia pro backend, que repassa pra Duttyfy — não precisa configurar nada extra pra isso funcionar com Meta Ads / TikTok Ads.
