// POST /api/create-pix
// Recebe os dados da doação do frontend, valida, e repassa pro gateway Duttyfy.
// A URL criptografada da Duttyfy (credencial) SÓ existe aqui, via variável de ambiente.
// Nunca é enviada ao navegador do usuário.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const GATEWAY_URL = process.env.DUTTYFY_PIX_URL;
  if (!GATEWAY_URL) {
    console.error('DUTTYFY_PIX_URL não configurada nas variáveis de ambiente da Vercel');
    return res.status(500).json({ error: 'Gateway de pagamento não configurado' });
  }

  try {
    const { amount, customer, item, utm } = req.body || {};

    // --- Validação básica ---
    if (!amount || typeof amount !== 'number' || amount < 100) {
      return res.status(400).json({ error: 'Valor inválido. Mínimo R$ 1,00.' });
    }
    if (!customer || !customer.name || !customer.document || !customer.email || !customer.phone) {
      return res.status(400).json({ error: 'Dados do doador incompletos.' });
    }

    const cleanDocument = String(customer.document).replace(/\D/g, '');
    const cleanPhone = String(customer.phone).replace(/\D/g, '');

    if (![11, 14].includes(cleanDocument.length)) {
      return res.status(400).json({ error: 'CPF/CNPJ inválido.' });
    }
    if (![10, 11].includes(cleanPhone.length)) {
      return res.status(400).json({ error: 'Telefone inválido. Inclua o DDD.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(customer.email)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }

    const payload = {
      amount,
      customer: {
        name: String(customer.name).trim(),
        document: cleanDocument,
        email: String(customer.email).trim(),
        phone: cleanPhone,
      },
      item: item && item.title
        ? { title: item.title, price: item.price ?? amount, quantity: item.quantity ?? 1 }
        : { title: 'Doação - Pietro, insumos e tratamento (Instituto Hub Social)', price: amount, quantity: 1 },
      paymentMethod: 'PIX',
      utm: typeof utm === 'string' ? utm : '',
    };

    // --- Retry com backoff exponencial só em 5xx / timeout, nunca em 4xx ---
    const delays = [1000, 2000, 4000];
    let lastErrorMessage = 'Falha ao gerar PIX';

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const gatewayRes = await fetch(GATEWAY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (gatewayRes.status >= 500) {
          lastErrorMessage = `Gateway retornou ${gatewayRes.status}`;
          if (attempt < delays.length) {
            await new Promise((r) => setTimeout(r, delays[attempt]));
            continue;
          }
          break;
        }

        const data = await gatewayRes.json();

        if (!gatewayRes.ok) {
          // 4xx: não faz retry, repassa o erro
          return res.status(gatewayRes.status).json({ error: data.error || 'Erro do gateway de pagamento' });
        }

        if (!data.pixCode || !data.transactionId) {
          return res.status(502).json({ error: 'Resposta inesperada do gateway' });
        }

        return res.status(200).json({
          pixCode: data.pixCode,
          transactionId: data.transactionId,
          status: data.status || 'PENDING',
        });
      } catch (err) {
        clearTimeout(timeoutId);
        lastErrorMessage = err.name === 'AbortError' ? 'Tempo esgotado ao contatar o gateway' : err.message;
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
      }
    }

    console.error('create-pix: falha após retries -', lastErrorMessage);
    return res.status(502).json({ error: 'Não foi possível gerar o PIX agora. Tente novamente em instantes.' });
  } catch (err) {
    console.error('create-pix: erro interno -', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
