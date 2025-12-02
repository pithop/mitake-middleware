# 🖥️ GUI d'Impression Mitake

## 🚀 Installation Simplifiée (Mode "Tout-en-un")

Grâce à la dernière mise à jour, le GUI est **directement intégré** dans l'application. Vous n'avez plus besoin de gérer le fichier `gui.html` séparément.

### 1. Préparation

Sur le PC du restaurant, vous devez avoir uniquement 2 fichiers dans le même dossier :

1.  `mitake-middleware.exe` (L'application)
2.  `.env` (Vos configurations et clés secrètes)

### 2. Lancement

1.  Faites un clic-droit sur `mitake-middleware.exe`
2.  Choisissez **"Exécuter en tant qu'administrateur"**
3.  Une fenêtre noire (console) s'ouvre. Attendez de voir :
    ```
    🌐 GUI DISPONIBLE : http://localhost:3000
    ```

### 3. Accès au GUI

1.  Ouvrez votre navigateur (Chrome, Firefox, Edge...)
2.  Allez à l'adresse : **[http://localhost:3000](http://localhost:3000)**
3.  L'interface de gestion s'affiche et se connecte automatiquement !

---

## 🔧 Fonctionnalités

✅ **Visualisation en temps réel** de toutes les commandes  
🔍 **Filtres intelligents** par statut d'impression et type de commande  
🖨️ **Impression manuelle** - Cliquez sur "Imprimer" pour changer le statut  
✅ **Marquage rapide** - Marquez une commande comme imprimée  
🔄 **Actualisation automatique** via Supabase Realtime  

---

## ❓ Dépannage

### "Impossible de charger le GUI"
Si vous voyez ce message dans la console noire, assurez-vous que vous utilisez bien la version `.exe` générée par GitHub Actions, car elle contient le fichier `gui.html` intégré.

### Le site http://localhost:3000 ne s'ouvre pas
Vérifiez dans la console noire si le port 3000 n'était pas occupé. Si c'est le cas, l'application a peut-être choisi le port 3001 ou 3002. Regardez le message :
`🌐 GUI DISPONIBLE : http://localhost:3001`

### "Erreur de connexion" sur la page web
Vérifiez que votre fichier `.env` contient bien les bonnes clés `SUPABASE_URL` et `SUPABASE_KEY`. L'application les lit et les injecte automatiquement dans la page web.

---

**Développé avec ❤️ pour Mitake Ramen**
