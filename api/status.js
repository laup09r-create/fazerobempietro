// GET /api/status?transactionId=...
// Consulta o status da cobrança PIX no gateway Duttyfy, sem expor a URL criptografada ao cliente.

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const GATEWAY_URL = process.env.DUTTYFY_PIX_URL;
  if (!GATEWAY_URL) {
    console.error('DUTTYFY_PIX_URL não configurada nas variáveis de ambiente da Vercel');
    return res.status(500).json({ error: 'Gateway de pagamento não configurado' });
  }

  const { transactionId } = req.query;
  if (!transactionId) {
    return res.status(400).json({ error: 'transactionId ausente' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `${GATEWAY_URL}?transactionId=${encodeURIComponent(transactionId)}`;
    const gatewayRes = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const data = await gatewayRes.json();

    if (!gatewayRes.ok) {
      return res.status(gatewayRes.status).json({ error: data.error || 'Erro ao consultar status' });
    }

    // Repassa só o necessário pro frontend
    return res.status(200).json({
      status: data.status,
      paidAt: data.paidAt || null,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('status: erro -', err.name === 'AbortError' ? 'timeout' : err.message, '| gateway:', GATEWAY_URL.slice(-8));
    return res.status(502).json({ error: 'Falha ao consultar status do pagamento' });
  }
}
