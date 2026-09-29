/* =====================================================================
   PROJECTS: the one place to edit your work.
   The home page shows them in the swipeable preview and the "recent work" grid,
   work.html (Lab) lists them all, and project.html?p=<slug> renders each one
   from the same template.

   - slug:    the page address (project.html?p=slug). Letters, numbers and dashes.
   - url:     the live site. Opens in a new tab.
   - shots:   screenshots in images/projects/ (captured from the live sites).
   - type:    one short line shown on cards.
   - tags:    used by the filters on the Lab page.
   - float:   the four colourful words that float around the home page preview.
   - sections: the story on the project page. The "My role" parts are placeholders
               for you to fill in, because only you know how you built it.
   ===================================================================== */
window.PROJECTS = [
  {
    slug: "porchlight",
    title: "Porchlight Support Hub",
    url: "https://porchlightwebproj.netlify.app/",
    shots: {
      desktop: "images/projects/porchlight-desktop.jpg",
      mobile: "images/projects/porchlight-mobile.jpg",
    },
    type: "Support hub website",
    tags: ["Web app", "Community"],
    float: ["community", "support", "maps", "accessible"],
    colors: ["#6b21a8", "#f5c451", "#e7d5f2", "#dfe8c8", "#ffffff"],
    summary:
      "A support hub for people facing homelessness or mental health challenges in Kent, built to get them to shelter, food or someone to talk to quickly.",
    sections: [
      {
        heading: "Overview",
        body: "Designed as a companion to Porchlight’s main website. Visitors pick how they’re feeling and are taken to the right place: an interactive map of shelters, food banks and services, anonymous support, ways to talk to someone, and guides and advice. A crisis phone number sits in a bar at the very top.",
      },
      {
        heading: "My role",
        body: "Placeholder: describe what you designed and built, the tools you used, and a decision you’re proud of.",
      },
    ],
  },
  {
    slug: "blueprint",
    title: "BluePrint",
    url: "https://blueprint-vwig.onrender.com/",
    shots: {
      desktop: "images/projects/blueprint-desktop.jpg",
      mobile: "images/projects/blueprint-mobile.jpg",
    },
    type: "Career tools web app",
    tags: ["Web app", "Careers"],
    float: ["careers", "CV builder", "clean UI", "tools"],
    colors: ["#1d4ed8", "#dbeafe", "#0b1b3f", "#93c5fd", "#ffffff"],
    summary:
      "Career tools that help you build, improve and manage your career, starting with a professional CV built around you.",
    sections: [
      {
        heading: "Overview",
        body: "BluePrint starts with a CV Builder: you tell it about yourself and it helps you create professional, personalised CVs. A cover letter builder, a job matcher and more career tools are planned as the platform grows.",
      },
      {
        heading: "My role",
        body: "Placeholder: describe what you designed and built, the tools you used, and a decision you’re proud of.",
      },
    ],
  },
  {
    slug: "coding-conf",
    title: "Coding Conf Tickets",
    url: "https://vermillion-panda-960b32.netlify.app/",
    shots: {
      desktop: "images/projects/coding-conf-desktop.jpg",
      mobile: "images/projects/coding-conf-mobile.jpg",
    },
    type: "Conference ticket generator",
    tags: ["Web app", "Frontend Mentor"],
    float: ["forms", "tickets", "uploads", "events"],
    colors: ["#0d0a2e", "#f57463", "#5b2bbd", "#ffffff", "#ffffff"],
    builtFor: "Frontend Mentor challenge",
    summary:
      "A ticket generator for Coding Conf 2025: upload an avatar, add your name, email and GitHub username, and get a personalised conference ticket.",
    sections: [
      {
        heading: "Overview",
        body: "A Frontend Mentor challenge. The form takes an avatar upload (JPG or PNG up to 500KB), a full name, an email address and a GitHub username, then generates a ticket showing your details, the event date and a ticket number.",
      },
      {
        heading: "My role",
        body: "Placeholder: describe how you approached the challenge and anything you added or learned.",
      },
    ],
  },
  {
    slug: "digitalbank",
    title: "Digitalbank",
    url: "https://digitalbankingweb.netlify.app/",
    shots: {
      desktop: "images/projects/digitalbank-desktop.jpg",
      mobile: "images/projects/digitalbank-mobile.jpg",
    },
    type: "Landing page",
    tags: ["Landing page", "Frontend Mentor"],
    float: ["fintech", "landing page", "responsive", "clean"],
    colors: ["#2d314d", "#31d35c", "#2bb7da", "#f3f4f6", "#ffffff"],
    builtFor: "Frontend Mentor challenge",
    summary: "A landing page for a next-generation digital bank, built from a Frontend Mentor challenge.",
    sections: [
      {
        heading: "Overview",
        body: "A marketing page with a hero and phone mockups, a “Why choose Digitalbank?” feature section (online banking, simple budgeting, fast onboarding and an open API), a grid of latest articles, and a footer with links and social icons.",
      },
      {
        heading: "My role",
        body: "Placeholder: describe how you approached the challenge and anything you added or learned.",
      },
    ],
  },
];
