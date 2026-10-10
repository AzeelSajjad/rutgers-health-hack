/**
 * CaseCoach Auth0 Pre User Registration Action.
 *
 * Configure the Action secret SCHOOL_EMAIL_DOMAINS as a comma-separated list
 * of the institution's approved email domains (for example: example.edu).
 * Attach this Action to the Pre User Registration flow. Never trust a school
 * domain supplied by the browser.
 */
exports.onExecutePreUserRegistration = async (event, api) => {
  const domains = (event.secrets.SCHOOL_EMAIL_DOMAINS || '')
    .split(',')
    .map(domain => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  const email = (event.user.email || '').trim().toLowerCase();
  const emailDomain = email.split('@').pop();

  if (!domains.length || !domains.includes(emailDomain)) {
    api.access.deny('school_email_required', 'Use an approved school email address to create your account.');
    return;
  }

  const firstName = (event.request.body['ulp-first-name'] || '').trim();
  const lastName = (event.request.body['ulp-last-name'] || '').trim();

  if (!firstName || !lastName || !event.user.username) {
    api.validation.error('invalid_payload', 'Enter your first name, last name, and username.');
    return;
  }

  api.user.setUserMetadata('first_name', firstName);
  api.user.setUserMetadata('last_name', lastName);
};
