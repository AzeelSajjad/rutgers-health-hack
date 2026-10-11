## Run the integrated demo

The integrated hackathon app is on the **demo** branch.

### Download and install

Use Node.js 22.23.1.

```bash
git clone --branch demo https://github.com/AzeelSajjad/rutgers-health-hack.git
cd rutgers-health-hack
npm ci
```

If you already cloned the repository, save your local changes first, then:

```bash
git fetch origin
git switch demo
git pull --ff-only origin demo
npm ci
```

### Run with live AWS services

Copy the configuration template:

```bash
cp backend/.env.example backend/.env
```

Update `backend/.env` with your AWS profile, region, and the actual DynamoDB table and S3 bucket names. The template contains placeholders. Valid AWS credentials and service permissions are required.

Then start the app:

```bash
npm run demo -- --local
```

Open **http://localhost:5173/**, choose Wyatt or Yvette, and begin a conversation.

This local demo uses AWS Transcribe, Bedrock, Polly, DynamoDB, and S3. Google login is bypassed for the local student demo; faculty review requires authenticated mode.

### Preview without AWS access

```bash
npm run demo -- --preview
