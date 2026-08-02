# Agent WhatsApp IA — SMART AUTOMATION

Backend Node.js qui reçoit les messages WhatsApp, génère une réponse via Groq (IA), répond automatiquement au client, et enregistre l'historique des conversations dans Supabase.

## Étapes pour le mettre en ligne

### 1. Créer une clé API Groq (gratuite)

- Va sur https://console.groq.com
- Crée un compte / connecte-toi
- Va dans "API Keys" → "Create API Key"
- Copie la clé (elle commence par `gsk_...`)

### 2. Créer le projet Supabase

- Va sur https://supabase.com et connecte-toi
- Crée (ou ouvre) ton projet
- Crée une table `messages` avec les colonnes :
  - `id` (int8, auto)
  - `created_at` (timestamp, défaut `now()`)
  - `phone_number` (text)
  - `sender` (text) — valeurs `client` ou `agent_ia`
  - `message` (text)
  - `conversation_id` (text)
  - `status` (text, optionnel)
- Dans Project Settings → API Keys, récupère :
  - `SUPABASE_URL` (l'URL du projet)
  - `SUPABASE_KEY` (la Secret key `sb_secret_...`, utilisée uniquement côté serveur)

### 3. Déployer sur Render

- Va sur https://render.com et connecte-toi (ou crée un compte gratuit)
- Clique sur "New +" → "Web Service"
- Connecte ton repo GitHub
- Configure :
  - Build Command : `npm install`
  - Start Command : `npm start`
  - Instance Type : Free
- Dans l'onglet "Environment", ajoute ces variables :
  - `VERIFY_TOKEN` → invente un mot de passe simple, ex: `smartauto2026`
  - `WHATSAPP_TOKEN` → ton token d'accès Meta
  - `PHONE_NUMBER_ID` → `1303734806147435`
  - `GROQ_API_KEY` → la clé copiée à l'étape 1
  - `SUPABASE_URL` → l'URL copiée à l'étape 2
  - `SUPABASE_KEY` → la Secret key copiée à l'étape 2
- Clique sur "Create Web Service" — Render va déployer automatiquement
- Une fois déployé, tu obtiens une URL du type : `https://ton-app.onrender.com`

### 4. Connecter le webhook sur Meta

- Retourne sur developers.facebook.com → ton app → WhatsApp → Configuration
- Section "Webhook" → clique "Modifier" (Edit)
- Callback URL : `https://ton-app.onrender.com/webhook`
- Verify Token : le même que celui mis dans `VERIFY_TOKEN` sur Render
- Clique "Vérifier et enregistrer"
- Une fois vérifié, dans "Champs de webhook", abonne-toi au champ "messages"

### 5. Tester

Envoie un message WhatsApp au numéro de test Meta depuis ton téléphone personnel (le numéro doit être ajouté comme destinataire autorisé dans la configuration Meta, max 5 numéros en mode test). L'agent devrait te répondre automatiquement en quelques secondes, et chaque échange devrait apparaître dans la table `messages` sur Supabase (onglet Table Editor).

## Notes importantes

- Le token d'accès Meta généré en mode "Essai" expire après 24h. Pour un usage permanent, il faudra générer un token système longue durée (System User Token) — étape à faire une fois que tout fonctionne.
- L'historique de conversation est désormais persisté dans Supabase (table `messages`), consultable à tout moment par l'équipe. Le contexte utilisé par l'IA pour générer ses réponses (les 10 derniers messages) reste en RAM et se réinitialise au redémarrage du serveur — mais l'historique complet dans Supabase, lui, est permanent.
- Render en tier gratuit met le serveur en veille après inactivité — le premier message après une pause peut prendre 30-60s à recevoir une réponse (le temps que le serveur se réveille).
- Ne jamais exposer la Secret key Supabase côté client/frontend — elle contourne les règles de sécurité (RLS) et doit rester uniquement en variable d'environnement serveur sur Render.
