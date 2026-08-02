require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GRAPH_API_VERSION = 'v20.0';

// Connexion Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Mémoire de conversation simple (en RAM). Se réinitialise si le serveur redémarre.
const conversationHistory = {};

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

    if (!message) {
      return;
    }

    if (processedMessageIds.has(message.id)) {
      return;
    }
    processedMessageIds.add(message.id);

    const from = message.from;
    const messageType = message.type;

    if (messageType !== 'text') {
      await sendWhatsAppMessage(from, "Je ne peux traiter que des messages texte pour le moment 🙏");
      return;
    }

    const userText = message.text.body;
    console.log(`📩 Message reçu de ${from}: ${userText}`);

    await saveMessage(from, 'client', userText);

    const aiResponse = await generateAIResponse(from, userText);

    await saveMessage(from, 'agent_ia', aiResponse);

    await sendWhatsAppMessage(from, aiResponse);

  } catch (error) {
    console.error('Erreur lors du traitement du webhook:', error.response?.data || error.message);
  }
});

// ==================== SAUVEGARDE DANS SUPABASE ====================
async function saveMessage(phoneNumber, sender, message) {
  try {
    await supabase.from('messages').insert({
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
async function generateAIResponse(userId, userMessage) {
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }

  conversationHistory[userId].push({ role: 'user', content: userMessage });

  const recentHistory = conversationHistory[userId].slice(-10);

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

    const aiText = response.data.choices[0].message.content;

    conversationHistory[userId].push({ role: 'assistant', content: aiText });

    return aiText;

  } catch (error) {
    console.error('Erreur Groq:', error.response?.data || error.message);
    return "Désolé, je rencontre un problème technique. Un membre de notre équipe vous répondra bientôt 🙏";
  }
}

// ==================== ENVOI DE MESSAGE WHATSAPP ====================
async function sendWhatsAppMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`📤 Réponse envoyée à ${to}`);
  } catch (error) {
    console.error('Erreur envoi WhatsApp:', error.response?.data || error.message);
  }
}

// ==================== ROUTE DE SANTÉ ====================
app.get('/', (req, res) => {
  res.send('🤖 Agent WhatsApp SMART AUTOMATION - En ligne');
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
