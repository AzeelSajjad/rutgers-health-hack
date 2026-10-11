/**
 * CaseCoach Auth0 Pre User Registration Action.
 *
 * Configure the Action secret SCHOOL_EMAIL_DOMAINS as a comma-separated list
 * of the institution's approved email domains (for example: example.edu).
 * Attach this Action to the Pre User Registration flow. Never trust a school
 * domain supplied by the browser.
 */
exports.onExecutePreUserRegistration = async (event, api) => {
  const approvedDomains = event.secrets?.SCHOOL_EMAIL_DOMAINS;
  const domains = (typeof approvedDomains === 'string' ? approvedDomains : '')
    .split(',')
    .map(domain => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  const email = typeof event.user?.email === 'string' ? event.user.email.trim().toLowerCase() : '';
  const emailDomain = email.split('@').pop();

  if (!domains.length || email.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(email) || !domains.includes(emailDomain)) {
    api.access.deny('school_email_required', 'Use an approved school email address to create your account.');
    return;
  }

  const text = (value, maxLength) => typeof value === 'string' && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '';
  const firstName = text(event.request?.body?.['ulp-first-name'], 120);
  const lastName = text(event.request?.body?.['ulp-last-name'], 120);
  const username = text(event.user?.username, 64);

  if (!firstName || !lastName || !username) {
    api.validation.error('invalid_payload', 'Enter your first name, last name, and username.');
    return;
  }

  api.user.setUserMetadata('first_name', firstName);
  api.user.setUserMetadata('last_name', lastName);
};
