interface Props {
    condition: boolean | (() => boolean);
    children: React.ReactNode;
}

export const If = ({ condition, children }: Props) => {
    const shouldRender =
        typeof condition === "function" ? condition() : condition;

    if (shouldRender) {
        return <>{children}</>;
    }
    return null;
};
