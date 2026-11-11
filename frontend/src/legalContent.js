// The words of the Privacy Policy and the Terms of Use, shown inside the game (LegalDialog.jsx).
// One place for both, so what the game says never drifts from what it does. When the game starts
// storing something new, or the rules change, change it here and bump LEGAL_UPDATED.
//
// A list item written as "Label — text" shows its label in bold. Plain strings are paragraphs;
// arrays are bullet lists.

export const LEGAL_UPDATED = '12 November 2026';

// Where people write about these documents. The server's CONTACT_EMAIL setting wins when it is set.
export const LEGAL_CONTACT = 'swipecovergame@gmail.com';

export const LEGAL = {
  privacy: {
    tab: 'Privacy',
    kicker: 'YOUR DATA, PLAINLY',
    title: 'Privacy Policy',
    intro:
      'Swipe Cover is a small puzzle game made by one person, not a data company. This page says exactly what the game keeps about you, why it keeps it, who can see it, and how to make it go away. It is written to be read.',
    summary: [
      { icon: 'lock', title: 'Never sold', text: 'We do not sell your data, show ads, or run trackers.' },
      { icon: 'mail', title: 'Email stays private', text: 'Other players only ever see your username.' },
      { icon: 'trash', title: 'Delete any time', text: 'Two clicks in the account menu erases your account.' },
    ],
    sections: [
      {
        id: 'overview',
        title: 'The short version',
        blocks: [
          'You can play every mode without an account, and then nothing about you is stored on our server. If you make an account, we keep what is needed to run it: a login, your scores, and your 1v1 record. We use that to show leaderboards, match you with opponents, and let you back in. We do not use it for anything else.',
        ],
      },
      {
        id: 'collect',
        title: 'What we keep when you have an account',
        blocks: [
          [
            'Your email address — used to log you in, to recognise you if you come back with Google, and (when switched on) to send a password reset link. It is never shown to other players.',
            'Your username — the name on leaderboards and shown to opponents. You choose it, and you can change it at any time.',
            'Your password, scrambled — we store a one-way scrypt hash, never the password itself. We cannot read it, and neither can anyone who gets a copy of the database.',
            'Google sign-in details — if you choose Google, the email address Google confirms and an identifier Google gives us for you. No password is involved.',
            'Your results — your times and moves for the daily levels, your Swipe Rush runs, and your 1v1 matches with their scores, results and your rating.',
            'Login sessions — a random code that keeps you logged in on this device for up to 30 days. We store only a fingerprint (a SHA-256 hash) of it, so a copy of the database cannot be used to log in as you.',
            'Reset codes — if you ask for a password reset, a fingerprint of the one-time code, kept until it is used or expires after one hour.',
          ],
        ],
      },
      {
        id: 'browser',
        title: 'What stays on your device',
        blocks: [
          'Your settings, your progress today, your login code, and any score still waiting to be sent are kept in your browser\'s local storage. That data lives on your device, and clearing your browser data removes it. The game uses no cookies, no advertising identifiers, and no analytics or tracking scripts.',
        ],
      },
      {
        id: 'why',
        title: 'Why we use it',
        blocks: [
          [
            'To run your account — logging in, keeping you logged in, and recovering your account.',
            'To run the game — checking that scores are real, ranking players, and matching you in 1v1.',
            'To keep it fair and safe — spotting bots and tampered scores, and stopping people from hammering the login and sign-up forms.',
          ],
          'That is the complete list. We do not build profiles, and we do not use your data to advertise to you.',
        ],
      },
      {
        id: 'visible',
        title: 'Who can see what',
        blocks: [
          [
            'Everyone — your username, your times and Swipe Rush scores on the leaderboards, and your 1v1 rating and win, loss and draw record.',
            'Your opponent — your username during a 1v1 match.',
            'Nobody but us — your email address, your password hash and your login codes.',
          ],
          'If you would rather not be recognised, pick a username that says nothing about who you are.',
        ],
      },
      {
        id: 'others',
        title: 'Other companies involved',
        blocks: [
          [
            'Our hosting provider — the game runs on a rented cloud server (currently Oracle Cloud). Like any web host, it handles your IP address when you connect and may keep it in its logs. Your account data is stored on that server.',
            'Google Fonts — supplies the game\'s lettering, so your browser contacts Google when the page loads.',
            'Google Sign-In — only if you choose it. Google tells us your confirmed email address and an identifier, and its own privacy policy applies to that sign-in.',
            'Email delivery — password reset emails go out through an email account the game owner controls. Only the reset email is sent that way.',
          ],
          'We do not sell your information, rent it, or share it for advertising. We may disclose data if the law requires it, or to protect the game and its players from abuse.',
        ],
      },
      {
        id: 'ip',
        title: 'IP addresses and abuse limits',
        blocks: [
          'To stop automated sign-ups and password guessing, the server counts recent requests per IP address. Those counters live in the server\'s memory only. They are not saved to your account and they disappear when the server restarts.',
        ],
      },
      {
        id: 'security',
        title: 'How we protect it',
        blocks: [
          [
            'Everything travels over HTTPS.',
            'Passwords are hashed with scrypt, and login and reset codes are stored only as hashes.',
            'Scores are checked by the server: it replays every submitted run before accepting it.',
            'Login attempts are rate limited, and changing your password logs out your other devices.',
          ],
          'No system is perfectly safe, and we cannot promise that nothing will ever go wrong. If a breach that puts your data at risk ever happens, we will let affected players know without unreasonable delay.',
        ],
      },
      {
        id: 'keep',
        title: 'How long we keep it',
        blocks: [
          'Your account and results stay until you delete your account. Login sessions expire after 30 days and reset codes after one hour. When you delete your account the data is erased from the live database straight away. Backup copies of the database may hold older versions for a short while before they are replaced.',
        ],
      },
      {
        id: 'rights',
        title: 'Your choices and rights',
        blocks: [
          [
            'Change your username — account button, then Change username.',
            'Delete your account — account button, then Delete account. This removes your account, your logins and your leaderboard times. Past 1v1 matches stay, without your name, so your opponents\' histories remain intact.',
            'Ask for a copy, or a correction — write to the contact address below and we will answer.',
            'Object or complain — you can write to us, and you may also have the right to complain to your local data protection authority.',
          ],
        ],
      },
      {
        id: 'children',
        title: 'Children',
        blocks: [
          'Swipe Cover is not meant for children under 13, and we do not knowingly collect their information. If you think a child has made an account, tell us and we will remove it.',
        ],
      },
      {
        id: 'changes',
        title: 'Changes to this policy',
        blocks: [
          'If this policy changes, the date at the top of this window changes with it, and we will announce important changes in the game. Continuing to play after a change means you accept the updated policy.',
        ],
      },
    ],
  },

  terms: {
    tab: 'Terms',
    kicker: 'HOUSE RULES',
    title: 'Terms of Use',
    intro:
      'These are the rules of the house. By playing Swipe Cover or making an account you agree to them. They are short on purpose: be a decent person, play fair, and the game stays fun for everyone.',
    summary: [
      { icon: 'play', title: 'Play fair', text: 'No bots, scripts or tampered scores.' },
      { icon: 'user', title: 'One person, one account', text: 'Keep your password to yourself.' },
      { icon: 'heart', title: 'Be decent', text: 'Friendly names, friendly matches.' },
    ],
    sections: [
      {
        id: 'agree',
        title: 'Agreeing to these terms',
        blocks: [
          'If you do not agree with these terms, please do not use the game. You must be at least 13 years old to make an account. If you are under the age of majority where you live, make sure a parent or guardian is happy for you to play.',
        ],
      },
      {
        id: 'account',
        title: 'Your account',
        blocks: [
          [
            'Give a real email address that you can read, and keep your password to yourself. You are responsible for what happens on your account.',
            'One person, one account. Please do not make several accounts to pad leaderboards or ratings.',
            'Do not use someone else\'s name, and do not pretend to be the game\'s owner or staff. Names that imitate them are not allowed.',
            'You can change your username and delete your account at any time from the account menu.',
          ],
        ],
      },
      {
        id: 'fair',
        title: 'Playing fair',
        blocks: [
          'Leaderboards and ratings are only worth something if they are honest. Please do not:',
          [
            'use bots, scripts, solvers or tampered requests to produce scores or 1v1 results;',
            'share solutions to the daily boards in a way that spoils them for others;',
            'exploit bugs for an advantage (please report them instead);',
            'deliberately lose, collude or trade wins in ranked matches to move ratings;',
            'attack, overload, probe or try to break into the game or its servers.',
          ],
          'The server checks every score by replaying it, and impossible runs are rejected.',
        ],
      },
      {
        id: 'conduct',
        title: 'Names and conduct',
        blocks: [
          'Usernames are the only thing other players see, so keep them friendly. Names that are hateful, harassing, sexual, illegal, or that impersonate someone are not allowed, and the game refuses many of them automatically. The same goes for how you behave toward the people you play against.',
        ],
      },
      {
        id: 'versus',
        title: '1v1 matches and ratings',
        blocks: [
          [
            'In a 1v1, the player who clears more maps before time runs out wins. A tie is broken by whoever cleared their last map first, and 0 to 0 is a draw.',
            'There are three ways to play: Quick match (3 minutes, anyone online, no rating), Ranked (5 minutes, against a player with a close rating) and Friend match (a code you share, lasting 1, 3 or 5 minutes, no rating).',
            'Only Ranked matches move your rating. Ranked matchmaking looks for a close rating first and widens its search the longer you wait.',
            'If you disconnect, the match keeps going and you can rejoin while it lasts.',
            'Ratings are a game mechanic, not a promise. We may adjust or reset them if the system changes or if cheating is found.',
          ],
        ],
      },
      {
        id: 'removal',
        title: 'If rules are broken',
        blocks: [
          'We may remove scores, reset ratings, change a username, or suspend or delete an account that breaks these rules, with or without warning. We would rather talk first, so if you think a mistake was made, write to us.',
        ],
      },
      {
        id: 'game',
        title: 'The game itself',
        blocks: [
          'Swipe Cover is provided as it is. We try to keep it running and the daily boards available, but we cannot promise that it will always work, be free of mistakes, or keep your scores and ratings forever. We may change, pause or end any part of it, including leaderboards and ratings.',
        ],
      },
      {
        id: 'ours',
        title: 'Who owns what',
        blocks: [
          'The game, its design, artwork and code belong to its owner or are used with permission. You are welcome to play it and share links to it. Please do not copy it and present it as your own. You keep any rights you have in your own words; by choosing a username you let us display it in the game.',
        ],
      },
      {
        id: 'liability',
        title: 'Liability',
        blocks: [
          'To the extent the law allows, we are not responsible for losses that come from using, or not being able to use, the game. Nothing here limits any rights you have by law that cannot be limited.',
        ],
      },
      {
        id: 'data',
        title: 'Your data',
        blocks: [
          'How the game handles your information is explained in the Privacy Policy, which is part of these terms.',
        ],
      },
      {
        id: 'changes',
        title: 'Changes to these terms',
        blocks: [
          'We may update these terms. The date at the top of this window shows the latest version, and continuing to play after a change means you accept it.',
        ],
      },
    ],
  },
};
