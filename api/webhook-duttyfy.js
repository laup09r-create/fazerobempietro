// POST /api/webhook-duttyfy
// A Duttyfy chama essa URL diretamente quando o status de uma transação muda pra COMPLETED —
// isso funciona mesmo que a pessoa já tenha fechado o navegador depois de pagar.
// Configurar no painel: Integrações e Chaves → Webhooks → colar a URL desse endpoint.
//
// Por que isso existe: o polling client-side (js do front) só marca a venda no TikTok se a
// pessoa ficar com a aba aberta até a confirmação. Na prática, a maioria fecha o app/aba depois
// de pagar pelo banco, então o pixel client-side sozinho perde a maior parte das conversões.
// Esse webhook é a fonte confiável que resolve isso.

const TIKTOK_PIXEL_CODE = 'D9IQGCRC77U84G6G8770'; // não é sensível, já está público no <head>

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(200).json({ ignored: true, reason: 'método não permitido' });
  }

  try {
    const body = req.body || {};
    const transactionId = body.transactionId || body.id;
    const status = body.status;

    if (status !== 'COMPLETED') {
      // Webhook de PENDING ou outro status: não nos interessa aqui.
      return res.status(200).json({ ignored: true, reason: 'status não é COMPLETED' });
    }

    if (!transactionId) {
      console.error('webhook-duttyfy: payload sem transactionId/id -', JSON.stringify(body));
      return res.status(200).json({ ignored: true, reason: 'sem transactionId' });
    }

    // --- Reverificação direto com a Duttyfy ---
    // A Duttyfy ainda não assina o webhook (HMAC está no roadmap deles), então, pra não confiar
    // cegamente em qualquer POST que chegar nessa URL, confirmamos o status direto na fonte
    // antes de reportar qualquer conversão.
    const GATEWAY_URL = process.env.DUTTYFY_PIX_URL;
    if (GATEWAY_URL) {
      try {
        const checkController = new AbortController();
        const checkTimeout = setTimeout(() => checkController.abort(), 8000);
        const checkRes = await fetch(`${GATEWAY_URL}?transactionId=${encodeURIComponent(transactionId)}`, {
          signal: checkController.signal,
        });
        clearTimeout(checkTimeout);
        const checkData = await checkRes.json();

        if (checkData.status !== 'COMPLETED') {
          console.error('webhook-duttyfy: reverificação não confirmou COMPLETED -', transactionId, checkData.status);
          return res.status(200).json({ ignored: true, reason: 'reverificação não confirmou COMPLETED' });
        }
      } catch (err) {
        console.error('webhook-duttyfy: falha na reverificação (seguindo mesmo assim) -', err.message);
        // Rede instável não deveria custar a venda: segue com cautela em vez de descartar.
      }
    } else {
      console.error('webhook-duttyfy: DUTTYFY_PIX_URL não configurada, pulando reverificação');
    }

    const amountCents = body.amount || (body.item && body.item.price) || 0;
    const value = amountCents / 100;
    const contentName = (body.item && body.item.title) || 'Doação PIX';

    const ACCESS_TOKEN = process.env.TIKTOK_EVENTS_API_TOKEN;
    if (!ACCESS_TOKEN) {
      console.error('webhook-duttyfy: TIKTOK_EVENTS_API_TOKEN não configurada — pagamento confirmado mas evento não enviado');
      return res.status(200).json({ confirmed: true, tiktok_sent: false, reason: 'token não configurado' });
    }

    const payload = {
      event_source: 'web',
      event_source_id: TIKTOK_PIXEL_CODE,
      data: [
        {
          event: 'CompletePayment',
          event_time: Math.floor(Date.now() / 1000),
          // Mesmo event_id usado no pixel client-side (api/create-pix + front usam 'pix_' + transactionId),
          // assim o TikTok deduplica automaticamente se os dois caminhos dispararem pro mesmo pagamento.
          event_id: 'pix_' + transactionId,
          properties: {
            value,
            currency: 'BRL',
            content_type: 'product',
            contents: [{ content_id: transactionId, content_name: contentName }],
          },
        },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const ttRes = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': ACCESS_TOKEN },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const ttData = await ttRes.json().catch(() => ({}));

    if (!ttRes.ok) {
      console.error('webhook-duttyfy: TikTok Events API erro -', ttRes.status, JSON.stringify(ttData));
      return res.status(200).json({ confirmed: true, tiktok_sent: false, error: ttData });
    }

    return res.status(200).json({ confirmed: true, tiktok_sent: true });
  } catch (err) {
    console.error('webhook-duttyfy: erro interno -', err.message);
    // Sempre responde 200: um erro nosso não deve fazer a Duttyfy ficar re-tentando o webhook.
    return res.status(200).json({ error: 'erro interno', message: err.message });
  }
};
