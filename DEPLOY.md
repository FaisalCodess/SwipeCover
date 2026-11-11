# Putting Swipe Cover online for free

The game needs three things from a host: a **disk that survives restarts** (accounts and scores live
in a SQLite file), **WebSockets** (1v1 mode), and **one always-running process** (matches live in
memory). Most free web hosts fail one of these: they sleep when idle, wipe their disk on every
restart, or both. A small free **virtual machine** has none of those problems, so this guide uses
one. Everything is free; Oracle only asks for a card to prove you are a person.

## 1. Get a free server (Oracle Cloud "Always Free")

1. Sign up at <https://www.oracle.com/cloud/free/>. Pick the home region closest to your players;
   you cannot change it later.
2. Create a VM instance: image **Ubuntu 22.04**, shape marked **Always Free** (the `VM.Standard.E2.1.Micro`
   or an Ampere `A1` shape). Download the SSH key it offers.
3. Open the web ports. On the instance's subnet, add **ingress rules** for TCP **80** and **443**
   from `0.0.0.0/0`. Then, on the server (step 3 below), run:
   ```bash
   sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
   sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
   ```

(Google Cloud's free `e2-micro` VM works the same way if you prefer it.)

## 2. A free web address

1. Go to <https://www.duckdns.org>, sign in, and create a name, for example `swipecover`. You get
   `swipecover.duckdns.org`.
2. Set its **current ip** to your VM's public IP address.

(If you own a domain, point an `A` record at the IP instead.)

## 3. Run the game

Put the code on GitHub first (the server downloads it from there), then on the VM:

```bash
ssh -i your-key ubuntu@YOUR_VM_IP
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && exit        # log in again so this takes effect
ssh -i your-key ubuntu@YOUR_VM_IP
git clone https://github.com/FaisalCodess/SwipeCover.git
cd SwipeCover/deploy
cp .env.example .env && nano .env            # set DOMAIN, CONTACT_EMAIL (and GOOGLE_CLIENT_ID if you use it)
docker compose up -d --build
```

Open `https://swipecover.duckdns.org`. The first start takes a few minutes while it builds, and the
HTTPS certificate arrives by itself within a minute.

To update after you change the code: `git pull && docker compose up -d --build` in that folder.
Accounts and scores are kept in a Docker volume and survive updates.

## 4. Back up the database

It holds every player's email. Once a day, copy a snapshot somewhere else:

```bash
cd ~/SwipeCover/deploy
docker compose exec -T app python -c "import sqlite3; s=sqlite3.connect('/data/scores.db'); d=sqlite3.connect('/data/backup.db'); s.backup(d)"
docker compose cp app:/data/backup.db ~/backup-$(date +%F).db
```

Add that to `crontab -e` to run daily, and copy the files off the server now and then
(for example with `scp`).

## 5. Optional: Sign in with Google

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials): create an **OAuth
client ID**, type **Web application**, add `https://swipecover.duckdns.org` under *Authorised
JavaScript origins*, then put the client ID in `deploy/.env` as `GOOGLE_CLIENT_ID` and run
`docker compose up -d`.

## 6. Optional: "Forgot password" emails

The game can email reset links through any SMTP account. With a Gmail account (free, about 500
emails a day):

1. In that Google account turn on **2-Step Verification**, then create an **App password**
   (Google account → Security → App passwords). Google shows a 16-letter code once.
2. In `deploy/.env` set `SMTP_HOST=smtp.gmail.com`, `SMTP_USER=` the Gmail address and
   `SMTP_PASSWORD=` the 16-letter code (no spaces), then run `docker compose up -d`.

Until these are set, the "Forgot password?" link stays hidden.

## What this does not cover

- **Email verification** (proving a new account's address is real) is not built. Password reset is: see step 6.
- The free VM is a single small machine: plenty for a few hundred players, not for a viral launch.
- Running it on your own PC (`docker compose up` in the main folder) is fine for friends on your
  network, but the game is only online while the PC is.
