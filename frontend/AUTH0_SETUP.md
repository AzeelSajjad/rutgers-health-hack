# CaseCoach Auth0 account setup

CaseCoach uses Auth0 Universal Login so passwords and verification codes are entered on Auth0-hosted pages. The browser app needs only the Auth0 tenant domain and a Single Page Application client ID. Never put an Auth0 client secret in this frontend.

## Student and faculty signup paths

The sign-in screen presents separate **Student sign up** and **Faculty sign up** actions. Both currently open the same Auth0-hosted signup prompt, while the app records which path initiated the redirect for display after signup. The faculty path is labeled as pending verification; it does not grant faculty permissions. Use an institutional invite or verified school affiliation in a trusted backend/Auth0 Action to assign faculty access, and enforce that role server-side. Never authorize faculty privileges from the browser's `casecoachAccountType` app state or session storage.

The hosted signup form and required profile fields are configured as described below. If student and faculty need different required fields or approval workflows, implement those policies in Auth0 Actions or a backend rather than trusting the selected button.

## Application settings

1. In Auth0, create or select an **Application** with type **Single Page Application**.
2. Add the exact CaseCoach origin to **Allowed Callback URLs**, **Allowed Logout URLs**, and **Allowed Web Origins**. For the current local preview, use `http://localhost:8000` in each field.
3. Copy the tenant domain (for example, `your-tenant.us.auth0.com`) and client ID into `auth-config.js`, replacing the placeholders.
4. Serve the `frontend` directory over HTTP and reload the page. For deployment, add the deployed HTTPS origin to all three allowlists too.

## Required signup fields and school email

Use an Auth0 **Database Connection** and enable the New Attributes Configuration / Flexible Identifiers. Configure **username** as the only login identifier and require it at signup. Keep **email** required on the profile for school eligibility, verification, recovery messages, and MFA, but disable email as a login identifier. Auth0 Flexible Identifiers lets a connection use username for login and password reset while separately requiring an email profile attribute.

Universal Login's standard signup form does not include first and last name fields. Auth0 requires a custom domain and page template for additional signup fields, and the Login Prompts page customization toggle must be off. In the Auth0 Management API prompt customization for `signup`, add these required fields to the signup form (keep any existing prompt content when updating it):

```json
{
  "signup": {
    "form-content-start": "<div class='ulp-field'><label for='first-name'>First name</label><input required name='ulp-first-name' id='first-name' autocomplete='given-name'></div><div class='ulp-field'><label for='last-name'>Last name</label><input required name='ulp-last-name' id='last-name' autocomplete='family-name'></div>"
  }
}
```

The database connection supplies the built-in school email, username, and password fields. The two added fields must use these submitted names:

- First Name: `ulp-first-name`
- Last Name: `ulp-last-name`

The corresponding Pre User Registration Action is in `auth0-actions/pre-user-registration.js`. Add an Action secret named `SCHOOL_EMAIL_DOMAINS` containing a comma-separated allowlist (for example `rutgers.edu,school.example.edu`), then attach the Action to **Actions > Flows > Pre User Registration**. The Action rejects unapproved domains and missing names or usernames, and saves the first and last names to user metadata. Do not use a browser-side domain check as the enforcement mechanism.

Auth0's additional signup fields require custom prompt/page setup and the Action; they cannot be enabled by changing this repo's client ID alone. If your Auth0 plan or tenant cannot use that setup, a separate backend signup implementation will be needed.

## Password policy

For the Database Connection, enable the **Flexible Password Policy** under **Authentication > Database > [connection] > Authentication Methods > Password > Configure**. Require at least 12 characters, uppercase, lowercase, a number, and a special character. Also enable the common-password dictionary, block personal profile data, and block sequential or repeated characters where available. Keep password login, password signup, and self-service password change enabled.

## Password recovery by email

Keep Auth0 self-service password changes enabled and configure a working Auth0 email provider and password reset email template. Require and verify the school email at signup. Universal Login then provides its Forgot Password flow and emails the reset link to the account's associated email; because username is the only login identifier, the reset form asks for the username.

## Text or email second-step verification

In **Security > Multi-factor Auth**, require MFA for CaseCoach and enable Phone Message (SMS) with a configured delivery provider. Enable the Email factor as an alternate method and enable the setting that shows available MFA methods. Auth0 email MFA requires a verified email and cannot be the only/first MFA factor, so users must first enroll another factor (SMS works here); after that, they can use email as an alternative. Configure phone capture/verification and explain SMS availability to users during enrollment.

## Local demo behavior

Until the tenant is configured, the sign-in page reports that Auth0 is not enabled and offers an explicitly unauthenticated demo preview. Authentication in this interface does not by itself protect an API or authorize access to patient data; a connected backend must validate access tokens and enforce its own access rules.

## Auth0 references

- [Vanilla JavaScript SPA quickstart](https://auth0.com/docs/quickstart/spa/vanillajs)
- [Flexible identifiers and attributes](https://auth0.com/docs/authenticate/database-connections/activate-and-configure-attributes-for-flexible-identifiers)
- [Custom fields on Universal Login signup](https://support.auth0.com/center/s/article/How-to-configure-additional-signup-fields-on-the-Universal-Login-Page)
- [Validate and store signup data with an Action](https://auth0.com/docs/customize/actions/actions-unit-test)
- [Flexible password policy](https://auth0.com/docs/authenticate/database-connections/flexible-password-policy)
- [Universal Login, signup, and password reset](https://auth0.com/docs/authenticate/login/auth0-universal-login/universal-login-vs-classic-login/universal-experience)
- [Configure SMS/voice MFA](https://auth0.com/docs/secure/multi-factor-authentication/multi-factor-authentication-factors/configure-sms-voice-notifications-mfa)
- [Email MFA requirements](https://support.auth0.com/center/s/article/Email-MFA-factor-missing-from-selection-screen)
