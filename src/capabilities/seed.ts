// Seed built-in capabilities into the database on first run.
// Idempotent: skips any capability that already exists by name.

import type { IFoundryRepository } from "../repository/index.js";
import type { CapabilityCategory, CapabilityActionType } from "../repository/types.js";

interface CapabilitySeed {
  name: string;
  category: CapabilityCategory;
  description: string;
  setupGuide: string;
  configSchema: Record<string, unknown>;
  actions: ActionSeed[];
}

interface ActionSeed {
  name: string;
  description: string;
  actionType: CapabilityActionType;
  script: string;
  paramSchema?: Record<string, unknown>;
  isDestructive?: boolean;
  requiresApproval?: boolean;
}

const BUILTIN_CAPABILITIES: CapabilitySeed[] = [
  {
    name: "GitHub",
    category: "infrastructure",
    description: "GitHub repository management — create repos, push branches, open PRs and issues.",
    setupGuide: `## GitHub Setup

1. Go to **github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Select scopes: \`repo\`, \`read:user\`
4. Copy the token and paste it below
5. Enter your GitHub username`,
    configSchema: {
      type: "object",
      properties: {
        token: { type: "string", title: "Personal Access Token", format: "password" },
        username: { type: "string", title: "GitHub Username" },
      },
      required: ["token", "username"],
    },
    actions: [
      {
        name: "capture-state",
        description: "Capture current GitHub account state (repos, open PRs, issues)",
        actionType: "http",
        script: JSON.stringify({
          method: "GET",
          url: "https://api.github.com/user/repos?per_page=100&sort=updated",
          headers: {
            Authorization: "token {{CRED_TOKEN}}",
            Accept: "application/vnd.github.v3+json",
          },
        }),
      },
      {
        name: "create-repo",
        description: "Create a new GitHub repository",
        actionType: "http",
        script: JSON.stringify({
          method: "POST",
          url: "https://api.github.com/user/repos",
          headers: {
            Authorization: "token {{CRED_TOKEN}}",
            "Content-Type": "application/json",
          },
          body: {
            name: "{{PARAM_REPO_NAME}}",
            description: "{{PARAM_DESCRIPTION}}",
            private: false,
            auto_init: true,
          },
        }),
        paramSchema: {
          type: "object",
          properties: {
            repo_name: { type: "string" },
            description: { type: "string" },
          },
          required: ["repo_name"],
        },
      },
      {
        name: "create-issue",
        description: "Open a GitHub issue",
        actionType: "http",
        script: JSON.stringify({
          method: "POST",
          url: "https://api.github.com/repos/{{CRED_USERNAME}}/{{PARAM_REPO}}/issues",
          headers: {
            Authorization: "token {{CRED_TOKEN}}",
            "Content-Type": "application/json",
          },
          body: {
            title: "{{PARAM_TITLE}}",
            body: "{{PARAM_BODY}}",
          },
        }),
        paramSchema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["repo", "title"],
        },
      },
      {
        name: "push-branch",
        description: "Push local branch to GitHub remote",
        actionType: "bash",
        script: `#!/bin/bash
set -e
cd "$PARAM_REPO_PATH"
git remote set-url origin "https://$CRED_USERNAME:$CRED_TOKEN@github.com/$CRED_USERNAME/$PARAM_REPO_NAME.git"
git push origin "$PARAM_BRANCH"
echo "Pushed $PARAM_BRANCH to $PARAM_REPO_NAME"`,
        paramSchema: {
          type: "object",
          properties: {
            repo_path: { type: "string" },
            repo_name: { type: "string" },
            branch: { type: "string" },
          },
          required: ["repo_path", "repo_name", "branch"],
        },
      },
    ],
  },
  {
    name: "Fly.io",
    category: "deployment",
    description: "Deploy and manage apps on Fly.io",
    setupGuide: `## Fly.io Setup

1. Install the Fly CLI: \`curl -L https://fly.io/install.sh | sh\`
2. Run \`fly auth login\` and complete the web login
3. Get your auth token: \`fly auth token\`
4. Paste the token below`,
    configSchema: {
      type: "object",
      properties: {
        token: { type: "string", title: "Fly Auth Token", format: "password" },
      },
      required: ["token"],
    },
    actions: [
      {
        name: "deploy",
        description: "Deploy app to Fly.io from a local directory",
        actionType: "bash",
        script: `#!/bin/bash
set -e
export FLY_API_TOKEN="$CRED_TOKEN"
cd "$PARAM_APP_PATH"
fly deploy --app "$PARAM_APP_NAME" --remote-only
echo "Deployed $PARAM_APP_NAME"`,
        paramSchema: {
          type: "object",
          properties: {
            app_path: { type: "string" },
            app_name: { type: "string" },
          },
          required: ["app_path", "app_name"],
        },
        isDestructive: true,
        requiresApproval: true,
      },
      {
        name: "set-secret",
        description: "Set an environment secret on a Fly app",
        actionType: "bash",
        script: `#!/bin/bash
set -e
export FLY_API_TOKEN="$CRED_TOKEN"
fly secrets set "$PARAM_KEY=$PARAM_VALUE" --app "$PARAM_APP_NAME"
echo "Secret $PARAM_KEY set on $PARAM_APP_NAME"`,
        paramSchema: {
          type: "object",
          properties: {
            app_name: { type: "string" },
            key: { type: "string" },
            value: { type: "string" },
          },
          required: ["app_name", "key", "value"],
        },
      },
      {
        name: "capture-state",
        description: "Capture current Fly.io app list",
        actionType: "bash",
        script: `#!/bin/bash
set -e
export FLY_API_TOKEN="$CRED_TOKEN"
fly apps list --json`,
      },
    ],
  },
  {
    name: "Vercel",
    category: "deployment",
    description: "Deploy frontend apps to Vercel",
    setupGuide: `## Vercel Setup

1. Go to **vercel.com → Settings → Tokens**
2. Click **Create Token**
3. Give it a name (e.g., "foundry") and set scope to your team or personal account
4. Copy the token and paste it below`,
    configSchema: {
      type: "object",
      properties: {
        token: { type: "string", title: "Vercel API Token", format: "password" },
        team_id: { type: "string", title: "Team ID (optional, for team accounts)" },
      },
      required: ["token"],
    },
    actions: [
      {
        name: "deploy",
        description: "Deploy a project to Vercel",
        actionType: "bash",
        script: `#!/bin/bash
set -e
cd "$PARAM_PROJECT_PATH"
npx vercel --token "$CRED_TOKEN" --yes --prod
echo "Deployed to Vercel"`,
        paramSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
          },
          required: ["project_path"],
        },
        isDestructive: true,
        requiresApproval: true,
      },
      {
        name: "capture-state",
        description: "List current Vercel deployments",
        actionType: "http",
        script: JSON.stringify({
          method: "GET",
          url: "https://api.vercel.com/v6/deployments?limit=10",
          headers: { Authorization: "Bearer {{CRED_TOKEN}}" },
        }),
      },
    ],
  },
  {
    name: "Linear",
    category: "infrastructure",
    description: "Issue tracking and project management via Linear",
    setupGuide: `## Linear Setup

1. Go to **linear.app → Settings → API**
2. Click **Create API key**
3. Give it a name and copy the key
4. Paste it below along with your team ID (visible in the URL when viewing your team)`,
    configSchema: {
      type: "object",
      properties: {
        api_key: { type: "string", title: "Linear API Key", format: "password" },
        team_id: { type: "string", title: "Team ID" },
      },
      required: ["api_key", "team_id"],
    },
    actions: [
      {
        name: "create-issue",
        description: "Create a new Linear issue",
        actionType: "http",
        script: JSON.stringify({
          method: "POST",
          url: "https://api.linear.app/graphql",
          headers: {
            Authorization: "{{CRED_API_KEY}}",
            "Content-Type": "application/json",
          },
          body: {
            query:
              "mutation CreateIssue($title: String!, $teamId: String!, $description: String) { issueCreate(input: { title: $title, teamId: $teamId, description: $description }) { success issue { id identifier title } } }",
            variables: {
              title: "{{PARAM_TITLE}}",
              teamId: "{{CRED_TEAM_ID}}",
              description: "{{PARAM_DESCRIPTION}}",
            },
          },
        }),
        paramSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
          },
          required: ["title"],
        },
      },
    ],
  },
  {
    name: "Stripe",
    category: "payments",
    description: "Create products, prices, and checkout sessions via Stripe",
    setupGuide: `## Stripe Setup

1. Go to **dashboard.stripe.com → Developers → API keys**
2. Copy the **Secret key** (starts with \`sk_\`)
3. Paste it below

Use test mode keys (\`sk_test_\`) during development.`,
    configSchema: {
      type: "object",
      properties: {
        secret_key: { type: "string", title: "Stripe Secret Key", format: "password" },
      },
      required: ["secret_key"],
    },
    actions: [
      {
        name: "create-product",
        description: "Create a Stripe product",
        actionType: "http",
        script: JSON.stringify({
          method: "POST",
          url: "https://api.stripe.com/v1/products",
          headers: {
            Authorization: "Bearer {{CRED_SECRET_KEY}}",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "name={{PARAM_NAME}}&description={{PARAM_DESCRIPTION}}",
        }),
        paramSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
          },
          required: ["name"],
        },
      },
      {
        name: "capture-state",
        description: "List Stripe products",
        actionType: "http",
        script: JSON.stringify({
          method: "GET",
          url: "https://api.stripe.com/v1/products?limit=20",
          headers: { Authorization: "Bearer {{CRED_SECRET_KEY}}" },
        }),
      },
    ],
  },
  {
    name: "npm",
    category: "infrastructure",
    description: "Publish and manage npm packages",
    setupGuide: `## npm Setup

1. Run \`npm login\` in your terminal
2. Get your token: \`cat ~/.npmrc | grep authToken\`
3. Copy the token value and paste it below`,
    configSchema: {
      type: "object",
      properties: {
        token: { type: "string", title: "npm Auth Token", format: "password" },
      },
      required: ["token"],
    },
    actions: [
      {
        name: "publish",
        description: "Publish a package to npm",
        actionType: "bash",
        script: `#!/bin/bash
set -e
cd "$PARAM_PACKAGE_PATH"
echo "//registry.npmjs.org/:_authToken=$CRED_TOKEN" > .npmrc
npm publish --access public
rm -f .npmrc
echo "Published package"`,
        paramSchema: {
          type: "object",
          properties: {
            package_path: { type: "string" },
          },
          required: ["package_path"],
        },
        isDestructive: true,
        requiresApproval: true,
      },
    ],
  },
  {
    name: "Email (SMTP)",
    category: "communication",
    description: "Send email via SMTP (Gmail, SendGrid, etc.)",
    setupGuide: `## SMTP Setup

For **Gmail**:
1. Enable 2FA on your account
2. Go to **myaccount.google.com → Security → App passwords**
3. Generate an app password for "Mail"
4. Use \`smtp.gmail.com\` as host, port \`587\`

For **SendGrid**:
1. Go to **app.sendgrid.com → Settings → API Keys**
2. Create an API key with "Mail Send" permission
3. Use \`smtp.sendgrid.net\` as host, port \`587\`, username \`apikey\``,
    configSchema: {
      type: "object",
      properties: {
        host: { type: "string", title: "SMTP Host" },
        port: { type: "string", title: "SMTP Port" },
        username: { type: "string", title: "Username" },
        password: { type: "string", title: "Password / API Key", format: "password" },
        from: { type: "string", title: "From Address" },
      },
      required: ["host", "port", "username", "password", "from"],
    },
    actions: [
      {
        name: "send",
        description: "Send an email",
        actionType: "bash",
        script: `#!/bin/bash
set -e
curl --url "smtp://$CRED_HOST:$CRED_PORT" \\
  --user "$CRED_USERNAME:$CRED_PASSWORD" \\
  --mail-from "$CRED_FROM" \\
  --mail-rcpt "$PARAM_TO" \\
  --ssl-reqd \\
  -T <(echo -e "From: $CRED_FROM\\nTo: $PARAM_TO\\nSubject: $PARAM_SUBJECT\\n\\n$PARAM_BODY")
echo "Email sent to $PARAM_TO"`,
        paramSchema: {
          type: "object",
          properties: {
            to: { type: "string" },
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["to", "subject", "body"],
        },
      },
    ],
  },
  {
    name: "Slack",
    category: "communication",
    description: "Post messages to Slack channels",
    setupGuide: `## Slack Setup

1. Go to **api.slack.com/apps → Create New App → From scratch**
2. Add the **Incoming Webhooks** feature and enable it
3. Click **Add New Webhook to Workspace** and select a channel
4. Copy the webhook URL and paste it below`,
    configSchema: {
      type: "object",
      properties: {
        webhook_url: { type: "string", title: "Webhook URL", format: "url" },
      },
      required: ["webhook_url"],
    },
    actions: [
      {
        name: "post-message",
        description: "Post a message to Slack",
        actionType: "http",
        script: JSON.stringify({
          method: "POST",
          url: "{{CRED_WEBHOOK_URL}}",
          headers: { "Content-Type": "application/json" },
          body: { text: "{{PARAM_MESSAGE}}" },
        }),
        paramSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
        },
      },
    ],
  },
  {
    name: "Twitter/X",
    category: "marketing",
    description: "Post tweets and track analytics via Twitter/X API",
    setupGuide: `## Twitter/X Setup

1. Go to **developer.twitter.com → Projects & Apps → Create App**
2. Apply for **Elevated access** (required for write permissions)
3. Under your app, go to **Keys and Tokens**
4. Generate **Access Token and Secret**
5. Copy all four values below`,
    configSchema: {
      type: "object",
      properties: {
        api_key: { type: "string", title: "API Key (Consumer Key)", format: "password" },
        api_secret: { type: "string", title: "API Secret (Consumer Secret)", format: "password" },
        access_token: { type: "string", title: "Access Token", format: "password" },
        access_secret: { type: "string", title: "Access Token Secret", format: "password" },
      },
      required: ["api_key", "api_secret", "access_token", "access_secret"],
    },
    actions: [
      {
        name: "post",
        description: "Post a tweet (requires twurl: gem install twurl)",
        actionType: "bash",
        script: `#!/bin/bash
set -e
if ! command -v twurl &> /dev/null; then
  echo "Error: twurl not installed. Run: gem install twurl"
  exit 1
fi
twurl -d "text=$PARAM_TEXT" /2/tweets`,
        paramSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
          required: ["text"],
        },
        requiresApproval: true,
      },
    ],
  },
  {
    name: "AWS S3",
    category: "infrastructure",
    description: "Upload files and manage objects in AWS S3",
    setupGuide: `## AWS S3 Setup

1. Go to **AWS Console → IAM → Users → Create User**
2. Attach the **AmazonS3FullAccess** policy (or a more restricted custom policy)
3. Under the user, go to **Security Credentials → Create Access Key**
4. Copy the Access Key ID and Secret Access Key
5. Enter your default region (e.g., \`us-east-1\`)`,
    configSchema: {
      type: "object",
      properties: {
        access_key_id: { type: "string", title: "Access Key ID" },
        secret_access_key: { type: "string", title: "Secret Access Key", format: "password" },
        region: { type: "string", title: "AWS Region" },
      },
      required: ["access_key_id", "secret_access_key", "region"],
    },
    actions: [
      {
        name: "upload",
        description: "Upload a file to S3",
        actionType: "bash",
        script: `#!/bin/bash
set -e
export AWS_ACCESS_KEY_ID="$CRED_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$CRED_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$CRED_REGION"
aws s3 cp "$PARAM_LOCAL_PATH" "s3://$PARAM_BUCKET/$PARAM_KEY"
echo "Uploaded to s3://$PARAM_BUCKET/$PARAM_KEY"`,
        paramSchema: {
          type: "object",
          properties: {
            local_path: { type: "string" },
            bucket: { type: "string" },
            key: { type: "string" },
          },
          required: ["local_path", "bucket", "key"],
        },
      },
    ],
  },
  {
    name: "Railway",
    category: "deployment",
    description: "Deploy apps to Railway",
    setupGuide: `## Railway Setup

1. Go to **railway.app → Account Settings → API Tokens**
2. Click **Create Token**
3. Copy the token and paste it below`,
    configSchema: {
      type: "object",
      properties: {
        token: { type: "string", title: "Railway API Token", format: "password" },
      },
      required: ["token"],
    },
    actions: [
      {
        name: "deploy",
        description: "Deploy a project to Railway via CLI",
        actionType: "bash",
        script: `#!/bin/bash
set -e
export RAILWAY_TOKEN="$CRED_TOKEN"
cd "$PARAM_PROJECT_PATH"
railway up --service "$PARAM_SERVICE_NAME"
echo "Deployed $PARAM_SERVICE_NAME to Railway"`,
        paramSchema: {
          type: "object",
          properties: {
            project_path: { type: "string" },
            service_name: { type: "string" },
          },
          required: ["project_path", "service_name"],
        },
        isDestructive: true,
        requiresApproval: true,
      },
      {
        name: "capture-state",
        description: "List Railway projects",
        actionType: "http",
        script: JSON.stringify({
          method: "POST",
          url: "https://backboard.railway.app/graphql/v2",
          headers: {
            Authorization: "Bearer {{CRED_TOKEN}}",
            "Content-Type": "application/json",
          },
          body: {
            query: "{ me { projects { edges { node { id name status } } } } }",
          },
        }),
      },
    ],
  },
];

export async function seedCapabilities(repo: IFoundryRepository): Promise<void> {
  const existing = repo.capabilities.listDefinitions();
  const existingNames = new Set(existing.map((c) => c.name));

  let seeded = 0;
  for (const cap of BUILTIN_CAPABILITIES) {
    if (existingNames.has(cap.name)) continue;

    const def = repo.capabilities.createDefinition({
      name: cap.name,
      category: cap.category,
      description: cap.description,
      setupGuide: cap.setupGuide,
      configSchema: cap.configSchema,
      isBuiltin: true,
    });

    for (const action of cap.actions) {
      repo.capabilities.createAction(def.id, {
        name: action.name,
        description: action.description,
        actionType: action.actionType,
        script: action.script,
        paramSchema: action.paramSchema ?? null,
        isDestructive: action.isDestructive ?? false,
        requiresApproval: action.requiresApproval ?? false,
      });
    }

    seeded++;
  }

  if (seeded > 0) {
    console.log(`[seed] Seeded ${seeded} built-in capabilities`);
  }
}
