# Agent WhatsApp IA — SMART AUTOMATION

Backend Node.js multi-clients et multi-offres qui reçoit les messages WhatsApp de plusieurs entreprises, génère une réponse via Groq (IA) selon le forfait souscrit, répond automatiquement au client, et enregistre l'historique des conversations dans Supabase — avec mémoire de conversation persistante et architecture RAG.

---

## 🚀 Fonctionnalités & Offres (Plans)

Le serveur s'adapte automatiquement au forfait de chaque entreprise cliente grâce au champ `plan` dans Supabase :

* **BASIC :** Chatbot rapide, réponse via Groq avec le prompt de l'entreprise (sans RAG) et capture simple de contacts.
* **STANDARD :** Agent IA avancé connecté à une base de connaissances **RAG (Supabase pgvector)** pour répondre précisément à partir des documents de l'entreprise.
* **PREMIUM / PRO :** RAG + **Function Calling (Tools Groq)** pour l'exécution d'actions dynamiques (enregistrement de leads, rendez-vous, appels d'API CRM) + détection et réponse multi-langue automatique.

---

## 🏗️ Architecture & Tables Supabase

### 1. Table `companies` (Entreprises clientes)
* `id` *(int8, auto)*
* `created_at` *(timestamptz, défaut now())*
* `name` *(text)* — Nom de l'entreprise cliente
* `whatsapp_phone_number_id` *(text)* — ID du numéro WhatsApp Meta
* `whatsapp_token` *(text)* — Token d'accès Meta propre à cette entreprise
* `email` *(text)* — Email de connexion au dashboard
* `password_hash` *(text)* — Mot de passe hashé
* `business_prompt` *(text)* — Directives spécifiques / Rôle de l'IA
* **`plan` *(text)*** — Niveau d'offre : `'BASIC'`, `'STANDARD'`, ou `'PREMIUM'` *(défaut: 'BASIC')*

### 2. Table `messages` (Historique des conversations)
* `id` *(int8, auto)*
* `created_at` *(timestamptz, défaut now())*
* `phone_number` *(text)* — Numéro du client final
* `sender` *(text)* — `client` ou `agent_ia`
* `message` *(text)*
* `conversation_id` *(text)* — Identifiant de la discussion (`phone_number`)
* `company_id` *(int8)* — Clé étrangère vers `companies.id`

### 3. Table `documents` (Base de connaissances RAG — Offres Standard & Premium)
* `id` *(int8, auto)*
* `company_id` *(int8)* — Clé étrangère vers `companies.id`
* `content` *(text)* — Contenu textuel / FAQ / Documentation produit

### 4. Table `leads` (Capture d'opportunités — Offre Premium / Pro)
* `id` *(int8, auto)*
* `company_id` *(int8)* — Clé étrangère vers `companies.id`
* `phone_number` *(text)* — Numéro du client
* `name` *(text)* — Nom du prospect
* `email` *(text)* — Email du prospect
* `service` *(text)* — Service/Produit recherché
* `created_at` *(timestamptz)*

---

## ⚙️ Configuration & Déploiement

### 1. Variables d'environnement (`.env` local et Render)
```env
PORT=3000
VERIFY_TOKEN=smartauto2026
GROQ_API_KEY=gsk_...
SUPABASE_URL=[https://your-project.supabase.co](https://your-project.supabase.co)
SUPABASE_KEY=sb_secret_...
JWT_SECRET=ton_secret_jwt_super_securise
