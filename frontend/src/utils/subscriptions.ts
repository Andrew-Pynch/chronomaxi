export const SubscriptionNames: { [key: string]: string } = {
    "chronomaxi-premium": "price_1PPXOyB9IyFHE5fKYpf9oB3Z",
    "chronomaxi-premium-dev": "price_1PPq2fB9IyFHE5fKmTv3sCjG",
};

export const StripeIdsToSubscriptionNames = Object.fromEntries(
    Object.entries(SubscriptionNames).map(([key, value]) => [value, key]),
);
