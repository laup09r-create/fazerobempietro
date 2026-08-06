// POST /api/track-purchase
// Dispara o evento de conversão (CompletePayment) pro TikTok via Events API (server-side),
// como reforço do pixel client-side. Usa o mesmo event_id do pixel pra o TikTok deduplicar.
// O access token da TikTok Events API fica só aqui (variável de ambiente), nunca no frontend.

const TIKTOK_PIXEL_CODE = 'D9IQGCRC77U84G6G8770'; // não é sensível, já está público no <head>

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const ACCESS_TOKEN = process.env.TIKTOK_EVENTS_API_TOKEN;
  if (!ACCESS_TOKEN) {
    console.error('TIKTOK_EVENTS_API_TOKEN não configurada nas variáveis de ambiente da Vercel');
    // Não derruba o fluxo de doação por causa disso — só loga e responde ok.
    return res.status(200).json({ skipped: true, reason: 'token não configurado' });
  }

  try {
    const { eventId, value, currency, contentId, contentName, pageUrl } = req.body || {};

    if (!eventId || !value) {
      return res.status(400).json({ error: 'eventId e value são obrigatórios' });
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const payload = {
      event_source: 'web',
      event_source_id: TIKTOK_PIXEL_CODE,
      data: [
        {
          event: 'CompletePayment',
          event_time: Math.floor(Date.now() / 1000),
          event_id: String(eventId),
          user: {
            ip: clientIp,
            user_agent: userAgent,
          },
          properties: {
            value: value,
            currency: currency || 'BRL',
            content_type: 'product',
            contents: [{ content_id: contentId || eventId, content_name: contentName || 'Doação PIX' }],
          },
          page: { url: pageUrl },
        },
      ],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const ttRes = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': ACCESS_TOKEN,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const ttData = await ttRes.json().catch(() => ({}));

    if (!ttRes.ok) {
      console.error('TikTok Events API erro:', ttRes.status, JSON.stringify(ttData));
      return res.status(200).json({ sent: false, error: ttData }); // não falha o front por isso
    }

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('track-purchase: erro -', err.message);
    // Falha silenciosa: rastreamento não pode travar a experiência de doação
    return res.status(200).json({ sent: false, error: err.message });
  }
};
