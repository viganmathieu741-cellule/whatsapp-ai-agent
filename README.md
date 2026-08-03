# Agent WhatsApp IA — SMART AUTOMATION

Backend Node.js multi-clients qui reçoit les messages WhatsApp de plusieurs entreprises, génère une réponse via Groq (IA), répond automatiquement au client, et enregistre l'historique des conversations dans Supabase — avec mémoire de conversation persistante (pas de perte de contexte au redémarrage).

## Architecture

- **`companies`** (table Supabase) : liste des entreprises clientes, chacune avec son propre numéro WhatsApp Business et son propre token Meta
- **`messages`** (table Supabase) : historique de toutes les conversations, liées à l'entreprise correspondante via `company_id`
- **`server.js`** : un seul serveur backend qui identifie automatiquement l'entreprise concernée par chaque message reçu (grâce au `phone_number_id` envoyé par Meta), et répond avec les bons identifiants

Ajouter un nouveau client = ajouter une ligne dans `companies`, sans toucher au code (le serveur rafraîchit sa liste d'entreprises toutes les 60 secondes).

## Étapes pour le mettre en ligne

### 1. Créer une clé API Groq (gratuite)

- Va sur https://console.groq.com
- Crée un compte / connecte-toi
- Va dans "API Keys" → "Create API Key"
- Copie la clé (elle commence par `gsk_...`)

### 2. Créer le projet Supabase

Va sur https://supabase.com, connecte-toi, crée (ou ouvre) ton projet, puis crée deux tables :

**Table `companies`** :
- `id` (int8, auto)
- `created_at` (timestamptz, défaut `now()`)
- `name` (text) — nom de l'entreprise cliente
- `whatsapp_phone_number_id` (text) — l'ID du numéro WhatsApp Meta de cette entreprise
- `whatsapp_token` (text) — le token d'accès Meta propre à cette entreprise
- `email` (text) — email de connexion au futur dashboard
- `password_hash` (text) — mot de passe (à sécuriser à l'étape du login)

**Table `messages`** :
- `id` (int8, auto)
- `created_at` (timestamptz, défaut `now()`)
- `phone_number` (text) — numéro du client final (celui qui écrit sur WhatsApp)
- `sender` (text) — valeurs `client` ou `agent_ia`
- `message` (text)
- `conversation_id` (text) — généralement identique à `phone_number`
- `company_id` (int8) — lien vers `companies.id`

Ajoute au moins une ligne dans `companies` avec les infos de ton premier client.

Dans **Project Settings → API Keys**, récupère :
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
  - `GROQ_API_KEY` → la clé copiée à l'étape 1
  - `SUPABASE_URL` → l'URL copiée à l'étape 2
  - `SUPABASE_KEY` → la Secret key copiée à l'étape 2

  > Note : `WHATSAPP_TOKEN` et `PHONE_NUMBER_ID` ne sont **plus nécessaires** en variables d'environnement globales — chaque entreprise a désormais son propre token/numéro stocké dans la table `companies`.

- Clique sur "Create Web Service" — Render va déployer automatiquement
- Une fois déployé, tu obtiens une URL du type : `https://ton-app.onrender.com`

### 4. Connecter le webhook sur Meta (pour chaque entreprise cliente)

Pour **chaque** numéro WhatsApp Business que tu gères (un par entreprise cliente) :

- Va sur developers.facebook.com → l'app correspondante → WhatsApp → Configuration
- Section "Webhook" → clique "Modifier" (Edit)
- Callback URL : `https://ton-app.onrender.com/webhook` (la même URL pour toutes les entreprises)
- Verify Token : le même que celui mis dans `VERIFY_TOKEN` sur Render
- Clique "Vérifier et enregistrer"
- Une fois vérifié, dans "Champs de webhook", abonne-toi au champ "messages"

### 5. Tester

Envoie un message WhatsApp au numéro de test Meta d'une entreprise depuis ton téléphone. L'agent devrait te répondre automatiquement en quelques secondes, et chaque échange devrait apparaître dans la table `messages` sur Supabase, avec le bon `company_id`.

Envoie plusieurs messages à la suite dans la même conversation pour vérifier que l'agent garde bien le contexte (mémoire persistante via Supabase).

## Notes importantes

- Le token d'accès Meta généré en mode "Essai" expire après 24h. Pour un usage permanent, il faudra générer un token système longue durée (System User Token) pour chaque entreprise, et mettre à jour son `whatsapp_token` dans la table `companies`.
- **Mémoire de conversation persistante** : l'IA relit désormais les 10 derniers messages de chaque conversation directement depuis Supabase avant de générer sa réponse. Elle ne perd plus le contexte, même si le serveur redémarre (mise en veille Render, redéploiement, etc.).
- Render en tier gratuit met le serveur en veille après inactivité — le premier message après une pause peut prendre 30-60s à recevoir une réponse (le temps que le serveur se réveille).
- Le serveur rafraîchit sa liste d'entreprises (`companies`) toutes les 60 secondes — pas besoin de redéployer pour qu'un nouveau client soit pris en compte, juste attendre une minute après l'avoir ajouté dans Supabase.
- Ne jamais exposer la Secret key Supabase côté client/frontend — elle contourne les règles de sécurité (RLS) et doit rester uniquement en variable d'environnement serveur sur Render.
- Prochaine étape prévue : dashboard web avec connexion par entreprise (email/mot de passe), pour que chaque client consulte ses propres conversations sans accéder à Supabase directement.
