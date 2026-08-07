require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GRAPH_API_VERSION = 'v20.0';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let companiesCache = {};
let lastCacheRefresh = 0;
const CACHE_DURATION_MS = 60000;

const processedMessageIds = new Set();

// Définition des outils pour le plan PREMIUM / PRO
const premiumTools = [
  {
    type: "function",
    function: {
      name: "save_lead_info",
      description: "Enregistre les informations d'un prospect (lead) dans la base de données dès qu'il fournit son nom, email, téléphone ou son besoin.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Le nom ou prénom du prospect" },
          email: { type: "string", description: "L'adresse email du prospect" },
          service: { type: "string", description: "Le service, produit ou besoin exprimé par le prospect" }
        },
        required: ["service"]
      }
    }
  }
];

// Fonction d'exécution de l'outil save_lead_info
async function executeToolCall(companyId, phoneNumber, toolCall) {
  if (toolCall.function.name === 'save_lead_info') {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      
      const { error } = await supabase.from('leads').insert({
        company_id: companyId,
        phone_number: phoneNumber,
        name: args.name || null,
        email: args.email || null,
        service: args.service || null
      });

      if (error) {
        console.error("Erreur insertion dans la table leads:", error.message);
        return "Erreur lors de l'enregistrement du lead.";
      }
      return "Lead enregistré avec succès dans la base de données.";
    } catch (e) {
      console.error("Erreur parsing arguments outil:", e.message);
      return "Erreur d'arguments pour l'outil.";
    }
  }
  return "Outil non reconnu.";
}

// Nettoyage des balises système et fuites de code dans le texte
function cleanResponseText(text) {
  if (!text) return "";
  return text
    .replace(/<function=.*?>.*?<\/function>/gs, '')
    .replace(/<.*?>/g, '')
    .trim();
}

// ==================== CHARGER LES ENTREPRISES DEPUIS SUPABASE ====================
async function refreshCompaniesCache() {
  try {
    const { data, error } = await supabase.from('companies').select('*');
    if (error) throw error;

    const newCache = {};
    for (const company of data) {
      newCache[company.whatsapp_phone_number_id] = company;
    }
    companiesCache = newCache;
    lastCacheRefresh = Date.now();
    console.log(`🔄 Cache entreprises rafraîchi (${data.length} entreprise(s))`);
  } catch (error) {
    console.error('Erreur chargement companies:', error.message);
  }
}

async function getCompanyByPhoneNumberId(phoneNumberId) {
  if (Date.now() - lastCacheRefresh > CACHE_DURATION_MS) {
    await refreshCompaniesCache();
  }
  return companiesCache[phoneNumberId] || null;
}

// ==================== MIDDLEWARE D'AUTHENTIFICATION (pour le dashboard) ====================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.companyId = decoded.companyId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Session invalide ou expirée' });
  }
}

// ==================== ROUTE DE CONNEXION AU DASHBOARD ====================
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const { data: company, error } = await supabase
      .from('companies')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !company) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    if (!company.password_hash) {
      return res.status(401).json({ error: 'Compte non configuré. Contactez SMART AUTOMATION.' });
    }

    const passwordMatch = await bcrypt.compare(password, company.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const token = jwt.sign(
      { companyId: company.id, companyName: company.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      company: { id: company.id, name: company.name, email: company.email }
    });

  } catch (error) {
    console.error('Erreur login:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTE : LISTE DES CONVERSATIONS ====================
app.get('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('conversation_id, phone_number, message, sender, created_at')
      .eq('company_id', req.companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const conversationsMap = {};
    for (const msg of data) {
      if (!conversationsMap[msg.conversation_id]) {
        conversationsMap[msg.conversation_id] = {
          conversation_id: msg.conversation_id,
          phone_number: msg.phone_number,
          last_message: msg.message,
          last_sender: msg.sender,
          last_message_at: msg.created_at
        };
      }
    }

    res.json(Object.values(conversationsMap));

  } catch (error) {
    console.error('Erreur récupération conversations:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTE : MESSAGES D'UNE CONVERSATION PRÉCISE ====================
app.get('/api/conversations/:conversationId/messages', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('company_id', req.companyId)
      .eq('conversation_id', req.params.conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json(data);

  } catch (error) {
    console.error('Erreur récupération messages:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ROUTE DE VÉRIFICATION WEBHOOK META (GET) ====================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook vérifié avec succès');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Échec de vérification du webhook');
    res.sendStatus(403);
  }
});

// ==================== ROUTE DE RÉCEPTION DES MESSAGES WHATSAPP (POST) ====================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const phoneNumberId = value?.metadata?.phone_number_id;

    if (!message) {
      return;
    }

    if (processedMessageIds.has(message.id)) {
      return;
    }
    processedMessageIds.add(message.id);

    const company = await getCompanyByPhoneNumberId(phoneNumberId);

    if (!company) {
      console.error(`⚠️ Aucune entreprise trouvée pour phone_number_id: ${phoneNumberId}`);
      return;
    }

    const from = message.from;
    const messageType = message.type;

    if (messageType !== 'text') {
      await sendWhatsAppMessage(company, from, "Je ne peux traiter que des messages texte pour le moment 🙏");
      return;
    }

    const userText = message.text.body;
    console.log(`📩 [${company.name}] Message reçu de ${from}: ${userText}`);

    await saveMessage(company.id, from, 'client', userText);

    const aiResponse = await generateAIResponse(company, from, userText);
    const cleanedResponse = cleanResponseText(aiResponse);

    if (cleanedResponse) {
      await saveMessage(company.id, from, 'agent_ia', cleanedResponse);
      await sendWhatsAppMessage(company, from, cleanedResponse);
    }

  } catch (error) {
    console.error('Erreur lors du traitement du webhook:', error.response?.data || error.message);
  }
});

// ==================== SAUVEGARDE DANS SUPABASE ====================
async function saveMessage(companyId, phoneNumber, sender, message) {
  try {
    await supabase.from('messages').insert({
      company_id: companyId,
      phone_number: phoneNumber,
      sender: sender,
      message: message,
      conversation_id: phoneNumber
    });
  } catch (error) {
    console.error('Erreur sauvegarde Supabase:', error.message);
  }
}

// ==================== GÉNÉRATION DE RÉPONSE VIA GROQ ====================
async function generateAIResponse(company, userId, userMessage) {
  const { data: history, error } = await supabase
    .from('messages')
    .select('sender, message')
    .eq('company_id', company.id)
    .eq('conversation_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Erreur lecture historique Supabase:', error.message);
  }

  const recentHistory = (history || [])
    .reverse()
    .map(m => ({
      role: m.sender === 'client' ? 'user' : 'assistant',
      content: m.message
    }));

  let systemPrompt = company.business_prompt ||
    `Tu es l'assistant virtuel de ${company.name}. Réponds en français, de façon concise et professionnelle.`;

  const userPlan = (company.plan || 'ESSENTIEL').toUpperCase();

  if (userPlan === 'PREMIUM' || userPlan === 'PRO') {
    systemPrompt += `\n\n[INSTRUCTIONS SPÉCIALES - MODE PREMIUM]:
1. Détecte la langue de l'utilisateur et réponds TOUJOURS dans sa langue.
2. Si l'utilisateur te donne ses coordonnées (nom, email, besoin) ET pose une question dans le même message, tu DOIS obligatoirement exécuter l'outil 'save_lead_info' ET répondre directement à ses questions dans le même message. Ne te contente jamais de dire seulement "C'est noté" ou "Merci".
3. N'affiche jamais de balises ou de code système dans ton message.`;
  }

  const messagesPayload = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: userMessage }
  ];

  try {
    const payload = {
      model: 'llama-3.3-70b-versatile',
      messages: messagesPayload,
      temperature: 0.3,
      max_tokens: 500
    };

    if (userPlan === 'PREMIUM' || userPlan === 'PRO') {
      payload.tools = premiumTools;
      payload.tool_choice = 'auto';
    }

    let response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      payload,
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    let responseMessage = response.data.choices[0].message;

    // Gestion du Tool Calling si l'IA souhaite enregistrer un lead
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      for (const toolCall of responseMessage.tool_calls) {
        await executeToolCall(company.id, userId, toolCall);
      }

      // Deuxième tour d'interrogation pour forcer la réponse textuelle
      messagesPayload.push(responseMessage);
      for (const toolCall of responseMessage.tool_calls) {
        messagesPayload.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify({ status: "success" })
        });
      }

      const secondResponse = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: messagesPayload,
          temperature: 0.3,
          max_tokens: 500
        },
        {
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return secondResponse.data.choices[0].message.content;
    }

    return responseMessage.content;

  } catch (error) {
    console.error('Erreur Groq:', error.response?.data || error.message);
    return "Désolé, je rencontre un problème technique. Un membre de notre équipe vous répondra bientôt 🙏";
  }
}

// ==================== ENVOI DE MESSAGE WHATSAPP ====================
async function sendWhatsAppMessage(company, to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${company.whatsapp_phone_number_id}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          'Authorization': `Bearer ${company.whatsapp_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`📤 [${company.name}] Réponse envoyée à ${to}`);
  } catch (error) {
    console.error('Erreur envoi WhatsApp:', error.response?.data || error.message);
  }
}

// ==================== ROUTE DE SANTÉ ====================
app.get('/', (req, res) => {
  res.send('🤖 Agent WhatsApp SMART AUTOMATION - En ligne (multi-clients, mémoire persistante, dashboard sécurisé)');
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  refreshCompaniesCache();
});
