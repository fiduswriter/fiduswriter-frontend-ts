// Map social account provider ids to Font Awesome brand icon names.
// The allauth openid_connect provider stands for an arbitrary OpenID
// Connect identity provider (for example an LDAP bridge via Dex,
// Keycloak or authentik), for which Font Awesome has a generic icon.
export const socialProviderIcon = (providerId: string): string => {
    const iconMap: Record<string, string> = {
        openid_connect: "openid"
    }
    return iconMap[providerId] || providerId
}
