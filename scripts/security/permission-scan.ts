/**
 * Static scan of every server entry point (Server Actions, Route Handlers, admin pages) for
 * its authorization guard (ARCHITECTURE.md §12 "review the permission check of every admin
 * Server Action"). Uses the TypeScript compiler API: comments and strings never count, only
 * real calls. Calls to helpers are followed into the helper (same file, or imported from
 * `src/app` / `src/actions`), and permission constants are resolved through imports and
 * re-exports, so `runAdminAction(schema, raw, SHIPPING_PERMISSION, …)`, file-local `run` /
 * `authorized` wrappers and shared page helpers are all recognised.
 *
 * Used by `src/actions/admin/permission-coverage.test.ts` (fails when an admin action has no
 * permission) and `scripts/security/permission-review.ts` (generates the review document).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

export type EntryKind = 'action' | 'route' | 'page';

export type EntryPoint = {
  kind: EntryKind;
  /** Repository-relative path with forward slashes. */
  file: string;
  /** Exported function name (`default` for pages, HTTP method for routes). */
  name: string;
  /** Permissions required (`<dynamic>` when the argument cannot be resolved statically). */
  permissions: string[];
  /** Permissions only tested with `hasPermission` (parts of a page or response). */
  conditional: string[];
  /** Other recognised guards (customer session, signatures, rate limits, …). */
  guards: string[];
  /** Whether the entry point validates input with Zod (`safeParse` / `parse`). */
  validates: boolean;
};

/** Calls that require a permission, by the index of the permission argument. */
const PERMISSION_CALLS: Record<string, number> = {
  requirePermission: 0,
  requireAdminPage: 0,
  runAdminAction: 2,
  assertCan: 1,
};

/** Other guards, by the function they call. */
const GUARD_CALLS: Record<string, string> = {
  getCustomerSession: 'customer session (own data only)',
  requireCustomerPage: 'customer session (own data only)',
  canViewOrder: 'order access (owner session or signed order token)',
  grantOrderAccess: 'issues a signed order-access token',
  rateLimited: 'rate limit',
  processGatewayNotification: 'gateway signature + amount/txn_ref match + idempotency',
  verify: 'HMAC signature',
  sameOrigin: 'Origin check',
  loadCurrentCart: "caller's own cart (cookie or session)",
  toNextJsHandler: 'Better Auth (own rate limits, CSRF and session rules)',
  vnpaySign: 'simulator signature (non-production only)',
  getSession: 'session lookup',
};

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

type Binding = { name: string; file: string | null };

type ModuleInfo = {
  file: string;
  source: ts.SourceFile;
  functions: Map<string, FunctionLike>;
  constants: Map<string, string>;
  /** Local name → imported name and resolved file. */
  imports: Map<string, Binding>;
  /** `export { a as b } from './x'`: b → a in x. */
  reexports: Map<string, Binding>;
  starExports: (string | null)[];
  exportedFunctions: { name: string; fn: FunctionLike }[];
};

type Findings = Omit<EntryPoint, 'kind' | 'file' | 'name'>;

function hasUseServer(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const list = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  return list.some((m) => m.kind === kind);
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

const toPosix = (path: string) => path.split(sep).join('/');

export class PermissionScanner {
  private readonly modules = new Map<string, ModuleInfo>();
  private readonly overrides = new Map<string, string>();

  constructor(private readonly root: string) {}

  /** Uses `text` instead of the file on disk (tests). */
  withSource(file: string, text: string): this {
    this.overrides.set(resolve(this.root, file), text);
    return this;
  }

  private resolveImport(fromFile: string, specifier: string): string | null {
    let base: string;
    if (specifier.startsWith('@/')) base = join(this.root, 'src', specifier.slice(2));
    else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
    else return null;
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ];
    for (const candidate of candidates) {
      if (this.overrides.has(candidate)) return candidate;
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  private load(file: string): ModuleInfo {
    const cached = this.modules.get(file);
    if (cached) return cached;
    const text = this.overrides.get(file) ?? readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const info: ModuleInfo = {
      file,
      source,
      functions: new Map(),
      constants: new Map(),
      imports: new Map(),
      reexports: new Map(),
      starExports: [],
      exportedFunctions: [],
    };
    this.modules.set(file, info);
    for (const statement of source.statements) this.record(info, statement);
    return info;
  }

  private record(info: ModuleInfo, statement: ts.Statement) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = this.resolveImport(info.file, statement.moduleSpecifier.text);
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const name = (element.propertyName ?? element.name).text;
          info.imports.set(element.name.text, { name, file: target });
        }
      }
      return;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const target = ts.isStringLiteral(statement.moduleSpecifier)
        ? this.resolveImport(info.file, statement.moduleSpecifier.text)
        : null;
      const clause = statement.exportClause;
      if (!clause) info.starExports.push(target);
      else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const name = (element.propertyName ?? element.name).text;
          info.reexports.set(element.name.text, { name, file: target });
        }
      }
      return;
    }
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      info.functions.set(statement.name.text, statement);
      if (exported) {
        const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
        info.exportedFunctions.push({
          name: isDefault ? 'default' : statement.name.text,
          fn: statement,
        });
      }
      return;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const init = unwrap(declaration.initializer);
        const name = declaration.name.text;
        if (ts.isStringLiteralLike(init)) info.constants.set(name, init.text);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          info.functions.set(name, init);
          if (exported) info.exportedFunctions.push({ name, fn: init });
        }
      }
    }
  }

  /** Follows a name through imports and re-exports to its declaration. */
  private lookup(
    info: ModuleInfo,
    name: string,
    depth = 0,
  ): { mod: ModuleInfo; constant?: string; fn?: FunctionLike } | null {
    if (depth > 8) return null;
    if (info.constants.has(name)) return { mod: info, constant: info.constants.get(name)! };
    if (info.functions.has(name)) return { mod: info, fn: info.functions.get(name)! };
    const via = info.imports.get(name) ?? info.reexports.get(name);
    if (via) return via.file ? this.lookup(this.load(via.file), via.name, depth + 1) : null;
    for (const target of info.starExports) {
      if (!target) continue;
      const found = this.lookup(this.load(target), name, depth + 1);
      if (found) return found;
    }
    return null;
  }

  /** Helpers are followed only inside the Next.js entry layers, never into domain modules. */
  private followable(mod: ModuleInfo): boolean {
    const file = toPosix(relative(this.root, mod.file));
    return file.startsWith('src/app/') || file.startsWith('src/actions/');
  }

  private inspect(mod: ModuleInfo, fn: FunctionLike, seen: Set<FunctionLike>, out: Findings) {
    if (seen.has(fn)) return;
    seen.add(fn);
    const argument = (value: ts.Expression | undefined): string | null => {
      if (!value) return null;
      const inner = unwrap(value);
      if (ts.isStringLiteralLike(inner)) return inner.text;
      if (ts.isIdentifier(inner)) return this.lookup(mod, inner.text)?.constant ?? '<dynamic>';
      return '<dynamic>';
    };
    const add = (list: string[], value: string | null) => {
      if (value && !list.includes(value)) list.push(value);
    };
    const follow = (name: string) => {
      const found = this.lookup(mod, name);
      if (found?.fn && this.followable(found.mod)) {
        this.inspect(found.mod, found.fn, seen, out);
      }
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node);
        if (name && name in PERMISSION_CALLS) {
          const value = argument(node.arguments[PERMISSION_CALLS[name]!]);
          // requireAdminPage() without argument: any staff member (`admin.access`).
          add(out.permissions, value ?? (name === 'requireAdminPage' ? 'admin.access' : null));
        }
        if (name === 'hasPermission') add(out.conditional, argument(node.arguments[1]));
        if (name && GUARD_CALLS[name]) add(out.guards, GUARD_CALLS[name]!);
        if (name === 'safeParse' || name === 'parse' || name === 'runAdminAction') {
          out.validates = true;
        }
        // Guard helpers are judged by their argument, not by their (parameterised) body.
        if (name && ts.isIdentifier(node.expression) && !(name in PERMISSION_CALLS)) follow(name);
        // Helpers passed as callbacks (e.g. `readAction(schema, raw, read)`).
        for (const arg of node.arguments) if (ts.isIdentifier(arg)) follow(arg.text);
      }
      // Server Components rendered as JSX (`<Content {...props} />`).
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        ts.isIdentifier(node.tagName)
      ) {
        follow(node.tagName.text);
      }
      ts.forEachChild(node, visit);
    };
    if (fn.body) visit(fn.body);
  }

  scanFile(file: string, kind: EntryKind | null): EntryPoint[] {
    const absolute = resolve(this.root, file);
    const mod = this.load(absolute);
    const effectiveKind = kind ?? (hasUseServer(mod.source) ? 'action' : null);
    if (!effectiveKind) return [];
    const result: EntryPoint[] = [];
    for (const { name, fn } of mod.exportedFunctions) {
      if (effectiveKind === 'route' && !HTTP_METHODS.has(name)) continue;
      if (effectiveKind === 'page' && name !== 'default') continue;
      if (effectiveKind === 'action' && !hasModifier(fn, ts.SyntaxKind.AsyncKeyword)) continue;
      const out: Findings = { permissions: [], conditional: [], guards: [], validates: false };
      this.inspect(mod, fn, new Set(), out);
      result.push({
        kind: effectiveKind,
        file: toPosix(relative(this.root, absolute)),
        name,
        ...out,
      });
    }
    return result;
  }
}

/** Scans one source text (tests). */
export function scanSource(file: string, text: string, kind: EntryKind | null): EntryPoint[] {
  return new PermissionScanner(process.cwd()).withSource(file, text).scanFile(file, kind);
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

/** Every entry point under `src/` (Server Actions, Route Handlers, admin pages). */
export function scanProject(root: string): EntryPoint[] {
  const scanner = new PermissionScanner(root);
  const entries: EntryPoint[] = [];
  for (const path of walk(join(root, 'src'))) {
    if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
    const file = toPosix(relative(root, path));
    let kind: EntryKind | null = null;
    if (/^src\/app\/.*\/route\.ts$/.test(file)) kind = 'route';
    else if (/^src\/app\/admin\/.*\/page\.tsx$/.test(file)) kind = 'page';
    if (!kind && !readFileSync(path, 'utf8').includes('use server')) continue;
    entries.push(...scanner.scanFile(file, kind));
  }
  return entries.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
}
