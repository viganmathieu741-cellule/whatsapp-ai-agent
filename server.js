require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // Ton mot de passe inventé (ex: smartauto2026)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // Token d'accès Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // Ton Phone Number ID
const GROQ_API_KEY = process.env.GROQ_API_KEY; // Clé API Groq
const GRAPH_API_VERSION = 'v20.0';

// Mémoire de conversation simple (en RAM). Se réinitialise si le serveur redémarre.
// Structure: { "22990xxxxxx": [{role: "user", content: "..."}, {role: "assistant", content: "..."}] }
const conversationHistory = {};

// Pour éviter de traiter deux fois le même message (WhatsApp peut renvoyer le même webhook)
const processedMessageIds = new Set();

// Le "personnage" de ton agent - à personnaliser selon ton business
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
// Meta appelle cette route une seule fois pour vérifier que le webhook t'appartient
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
  // Répondre immédiatement à Meta (sinon il renvoie le webhook en boucle)
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      // Ce n'est pas un nouveau message (ex: accusé de lecture), on ignore
      return;
    }

    // Éviter de traiter deux fois le même message
    if (processedMessageIds.has(message.id)) {
      return;
    }
    processedMessageIds.add(message.id);

    const from = message.from; // Numéro de l'expéditeur
    const messageType = message.type;

    if (messageType !== 'text') {
      await sendWhatsAppMessage(from, "Je ne peux traiter que des messages texte pour le moment 🙏");
      return;
    }

    const userText = message.text.body;
    console.log(`📩 Message reçu de ${from}: ${userText}`);

    // Générer la réponse via Groq
    const aiResponse = await generateAIResponse(from, userText);

    // Envoyer la réponse sur WhatsApp
    await sendWhatsAppMessage(from, aiResponse);

  } catch (error) {
    console.error('Erreur lors du traitement du webhook:', error.response?.data || error.message);
  }
});

// ==================== GÉNÉRATION DE RÉPONSE VIA GROQ ====================
async function generateAIResponse(userId, userMessage) {
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }

  // Ajouter le message de l'utilisateur à l'historique
  conversationHistory[userId].push({ role: 'user', content: userMessage });

  // Garder seulement les 10 derniers messages pour ne pas surcharger le contexte
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

    // Sauvegarder la réponse dans l'historique
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

// ==================== ROUTE DE SANTÉ (pour vérifier que le serveur tourne) ====================
app.get('/', (req, res) => {
  res.send('🤖 Agent WhatsApp SMART AUTOMATION - En ligne');
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
