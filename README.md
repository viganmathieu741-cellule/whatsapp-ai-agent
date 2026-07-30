# Agent WhatsApp IA — SMART AUTOMATION

Backend Node.js qui reçoit les messages WhatsApp, génère une réponse via Groq (IA),
et répond automatiquement au client.

## Étapes pour le mettre en ligne

### 1. Créer une clé API Groq (gratuite)
1. Va sur https://console.groq.com
2. Crée un compte / connecte-toi
3. Va dans "API Keys" → "Create API Key"
4. Copie la clé (elle commence par `gsk_...`)

### 2. Déployer sur Render
1. Va sur https://render.com et connecte-toi (ou crée un compte gratuit)
2. Clique sur "New +" → "Web Service"
3. Connecte ton repo GitHub (il faut d'abord uploader ce code sur GitHub — voir étape 2bis si besoin)
4. Configure :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
5. Dans l'onglet "Environment", ajoute ces variables (Environment Variables) :
   - `VERIFY_TOKEN` → invente un mot de passe simple, ex: `smartauto2026`
   - `WHATSAPP_TOKEN` → ton token d'accès Meta
   - `PHONE_NUMBER_ID` → `1303734806147435`
   - `GROQ_API_KEY` → la clé copiée à l'étape 1
6. Clique sur "Create Web Service" — Render va déployer automatiquement
7. Une fois déployé, tu obtiens une URL du type : `https://ton-app.onrender.com`

### 3. Connecter le webhook sur Meta
1. Retourne sur developers.facebook.com → ton app → WhatsApp → Configuration
2. Section "Webhook" → clique "Modifier" (Edit)
3. **Callback URL** : `https://ton-app.onrender.com/webhook`
4. **Verify Token** : le même que celui mis dans `VERIFY_TOKEN` sur Render (ex: `smartauto2026`)
5. Clique "Vérifier et enregistrer"
6. Une fois vérifié, dans "Champs de webhook", abonne-toi au champ **"messages"**

### 4. Tester
Envoie un message WhatsApp au numéro de test Meta depuis ton téléphone personnel
(le numéro doit être ajouté comme destinataire autorisé dans la configuration Meta,
max 5 numéros en mode test). L'agent devrait te répondre automatiquement en quelques secondes.

## Notes importantes
- Le token d'accès Meta généré en mode "Essai" expire après 24h. Pour un usage permanent,
  il faudra générer un token système longue durée (System User Token) — étape à faire une
  fois que tout fonctionne.
- L'historique de conversation est stocké en mémoire (RAM) : il est perdu si le serveur redémarre.
  Render en tier gratuit met le serveur en veille après inactivité — le premier message après
  une pause peut prendre 30-60s à recevoir une réponse (le temps que le serveur se réveille).
