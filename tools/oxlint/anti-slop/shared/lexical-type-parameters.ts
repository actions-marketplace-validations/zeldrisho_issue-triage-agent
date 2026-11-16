import type { ESTree } from "vite-plus/lint/plugins";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;

function isNode(value: unknown): value is ESTree.Node {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}

function collectInferTypeParameterNames(
	node: ESTree.Node,
	visitorKeys: VisitorKeys,
	names: Set<string>,
): void {
	if (node.type === "TSConditionalType") return;
	if (node.type === "TSInferType") names.add(node.typeParameter.name.name);
	const record = node as unknown as Readonly<Record<string, unknown>>;
	for (const key of visitorKeys[node.type] ?? []) {
		const value = record[key];
		if (isNode(value)) {
			collectInferTypeParameterNames(value, visitorKeys, names);
			continue;
		}
		if (!Array.isArray(value)) continue;
		for (const child of value) {
			if (isNode(child)) collectInferTypeParameterNames(child, visitorKeys, names);
		}
	}
}

/** Collect type binders that are in scope at a node and can shadow module aliases. */
export function lexicalTypeParameterNames(
	node: ESTree.Node,
	visitorKeys: VisitorKeys,
): ReadonlySet<string> {
	const names = new Set<string>();
	let descendant: ESTree.Node = node;
	let current: ESTree.Node | null = node;
	while (current !== null && current.type !== "Program") {
		if ("typeParameters" in current) {
			for (const parameter of current.typeParameters?.params ?? []) {
				names.add(parameter.name.name);
			}
		}
		if (
			current.type === "TSMappedType" &&
			(descendant === current.nameType || descendant === current.typeAnnotation)
		) {
			names.add(current.key.name);
		}
		if (current.type === "TSConditionalType" && descendant === current.trueType) {
			collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
		}
		descendant = current;
		current = current.parent;
	}
	return names;
}

/** Distance to the closest enclosing scope introducing a type parameter. */
export function lexicalTypeParameterDistance(
	name: string,
	node: ESTree.Node,
	visitorKeys: VisitorKeys,
): number | null {
	let current: ESTree.Node | null = node;
	let descendant: ESTree.Node = node;
	let distance = 0;
	while (current !== null && current.type !== "Program") {
		if ("typeParameters" in current && current.typeParameters?.params.some((parameter) => parameter.name.name === name)) return distance;
		if (current.type === "TSMappedType" && (descendant === current.nameType || descendant === current.typeAnnotation) && current.key.name === name) return distance;
		if (current.type === "TSConditionalType" && descendant === current.trueType) {
			const names = new Set<string>();
			collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
			if (names.has(name)) return distance;
		}
		descendant = current;
		current = current.parent;
		distance += 1;
	}
	return null;
}
