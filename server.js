require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GRAPH_API_VERSION = 'v20.0';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Connexion Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Cache en mémoire des entreprises (pour éviter de requêter Supabase à chaque message)
let companiesCache = {};
let lastCacheRefresh = 0;
const CACHE_DURATION_MS = 60000; // rafraîchit le cache toutes les 60s

// Pour éviter de traiter deux fois le même message
const processedMessageIds = new Set();

const SYSTEM_PROMPT = `Tu es l'assistant virtuel de SMART AUTOMATION, une entreprise basée au Bénin
qui propose des services de consulting en automatisation IA pour les entreprises
(agents IA, automatisation de workflows, chatbots, etc.).

Ton rôle :
- Répondre aux questions des prospects et clients de façon professionnelle et chaleureuse
- Présenter les services de SMART AUTOMATION quand c'est pertinent
- Collecter les besoins du client (quel processus veut-il automatiser ?)
- Rediriger vers une prise de rendez-vous ou un devis si le client est intéressé
- Répondre en français, de façon concise (messages WhatsApp courts)
- Si tu ne sais pas répondre à une question technique précise, propose de mettre le client
  en contact avec un humain

Reste toujours poli, professionnel, et évite les réponses trop longues (max 3-4 phrases).`;

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

// ==================== ROUTE DE VÉRIFICATION (GET) ====================
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

// ==================== ROUTE DE RÉCEPTION DES MESSAGES (POST) ====================
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

    // Identifier l'entreprise correspondant à ce numéro WhatsApp
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

    const aiResponse = await generateAIResponse(company.id, from, userText);

    await saveMessage(company.id, from, 'agent_ia', aiResponse);

    await sendWhatsAppMessage(company, from, aiResponse);

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

// ==================== GÉNÉRATION DE RÉPONSE VIA GROQ (mémoire persistante via Supabase) ====================
async function generateAIResponse(companyId, userId, userMessage) {
  // Récupérer les 10 derniers messages de cette conversation depuis Supabase
  const { data: history, error } = await supabase
    .from('messages')
    .select('sender, message')
    .eq('company_id', companyId)
    .eq('conversation_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Erreur lecture historique Supabase:', error.message);
  }

  // Remettre dans l'ordre chronologique et convertir au format attendu par Groq
  const recentHistory = (history || [])
    .reverse()
    .map(m => ({
      role: m.sender === 'client' ? 'user' : 'assistant',
      content: m.message
    }));

  // Ajouter le nouveau message de l'utilisateur
  recentHistory.push({ role: 'user', content: userMessage });

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...recentHistory
        ],
        temperature: 0.7,
        max_tokens: 300
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;

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
  res.send('🤖 Agent WhatsApp SMART AUTOMATION - En ligne (multi-clients, mémoire persistante)');
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  refreshCompaniesCache(); // charge les entreprises au démarrage
});
