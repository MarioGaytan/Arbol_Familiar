import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Cookie, FileText, ShieldCheck } from 'lucide-react';
import { api, type LegalConfig } from '../api';

export type LegalDoc = 'privacidad' | 'terminos' | 'cookies';

const TITLES: Record<LegalDoc, string> = {
  privacidad: 'Aviso de Privacidad Integral',
  terminos: 'Términos y Condiciones de Uso',
  cookies: 'Política de Cookies',
};

/** Muestra el dato configurado o un marcador visible para que el responsable lo complete. */
function V({ v, ph }: { v: string | null | undefined; ph: string }) {
  return v ? <strong>{v}</strong> : <mark title="Configura esta variable de entorno">[{ph}]</mark>;
}

function Privacy({ c }: { c: LegalConfig }) {
  const who = <V v={c.controller.name} ph="Nombre del responsable — LEGAL_CONTROLLER_NAME" />;
  const mail = <V v={c.controller.email} ph="Correo de privacidad — LEGAL_CONTACT_EMAIL" />;
  return (
    <>
      <p>
        En cumplimiento de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP), su
        Reglamento y demás disposiciones aplicables, se emite el presente Aviso de Privacidad Integral.
      </p>

      <h2>1. Identidad y domicilio del responsable</h2>
      <p>
        El responsable del tratamiento de tus datos personales es {who}, con domicilio en{' '}
        <V v={c.controller.address} ph="Domicilio — LEGAL_CONTROLLER_ADDRESS" />. Para cualquier asunto relacionado con
        tus datos personales puedes escribir a {mail}.
      </p>

      <h2>2. Datos personales que tratamos</h2>
      <p><b>a) Datos de tu cuenta:</b> nombre, correo electrónico y contraseña (que se guarda cifrada mediante una función de derivación irreversible; nadie, ni siquiera el responsable, puede leerla).</p>
      <p>
        <b>b) Datos que tú registras en tus árboles</b> sobre ti y sobre otras personas: nombres, género, fechas y lugares
        de nacimiento y fallecimiento, fotografías, notas y relaciones de parentesco.
      </p>
      <p><b>c) Datos técnicos:</b> un identificador de sesión (cookie), la fecha de tu último acceso y la fecha y versión de este aviso que aceptaste. El servidor puede registrar temporalmente la dirección IP de las solicitudes con fines de seguridad (por ejemplo, para limitar intentos de inicio de sesión).</p>

      <h2>3. Datos personales sensibles</h2>
      <p>
        No solicitamos datos personales sensibles (como estado de salud, creencias religiosas, origen étnico, opiniones
        políticas o preferencia sexual). Te pedimos no registrarlos en las notas, especialmente de personas vivas. Si
        decides hacerlo, lo haces bajo tu responsabilidad y con el consentimiento expreso de la persona titular.
      </p>

      <h2>4. Finalidades del tratamiento</h2>
      <p>Tus datos se utilizan únicamente para las siguientes <b>finalidades primarias</b>, necesarias para el servicio:</p>
      <ul>
        <li>Crear y administrar tu cuenta y autenticarte.</li>
        <li>Guardar, mostrar, organizar, exportar e imprimir los árboles genealógicos que creas.</li>
        <li>Compartir tus árboles con las personas que tú invites y, si tú lo activas, mediante un enlace público de sólo lectura.</li>
        <li>Mantener la seguridad e integridad del servicio y prevenir accesos no autorizados.</li>
        <li>Atender tus solicitudes de derechos ARCO y cumplir obligaciones legales.</li>
      </ul>
      <p>
        <b>No utilizamos tus datos para finalidades secundarias</b>: no hacemos mercadotecnia, publicidad, perfilamiento ni
        venta de datos.
      </p>

      <h2>5. Datos de terceros y de menores de edad</h2>
      <p>
        Al registrar información de otras personas (familiares vivos o fallecidos) declaras que cuentas con su
        consentimiento o con un interés legítimo para hacerlo, y que en el caso de menores de edad o personas en estado de
        interdicción cuentas con la autorización de quien ejerce la patria potestad o la tutela. El registro en la
        plataforma está reservado a personas mayores de edad.
      </p>
      <p>
        Por defecto, en los enlaces públicos se ocultan las fotografías, fechas y lugares de las personas vivas.
      </p>

      <h2>6. Transferencias y remisiones</h2>
      <p>
        No transferimos tus datos personales a terceros, salvo las excepciones previstas por la ley (por ejemplo, por
        requerimiento de autoridad competente). Para operar el servicio, los datos se alojan con proveedores de
        infraestructura que actúan como encargados y sólo los tratan para prestarnos ese servicio: hospedaje y base de
        datos (Railway) y almacenamiento de fotografías (Cloudflare). Estos proveedores pueden almacenar la información
        fuera de México, con medidas de seguridad equivalentes.
      </p>
      <p>Tus árboles sólo los ven las personas a quienes tú das acceso o, si tú lo decides, quienes tengan el enlace público.</p>

      <h2>7. Derechos ARCO y revocación del consentimiento</h2>
      <p>
        Tienes derecho a <b>Acceder</b> a tus datos, <b>Rectificarlos</b>, <b>Cancelarlos</b> y <b>Oponerte</b> a su
        tratamiento, así como a revocar tu consentimiento. Puedes ejercerlos:
      </p>
      <ul>
        <li><b>Desde la aplicación</b>, en <i>Mi cuenta</i>: descargar todos tus datos (acceso y portabilidad), corregir tu nombre y contraseña (rectificación) y eliminar tu cuenta con sus árboles (cancelación y revocación).</li>
        <li><b>Por correo</b> a {mail}, indicando: tu nombre y correo de la cuenta, el derecho que deseas ejercer, la descripción clara de los datos involucrados y, en su caso, el documento que acredite tu identidad o la representación legal.</li>
      </ul>
      <p>
        Responderemos en un plazo máximo de <b>20 días hábiles</b> contados desde la recepción de la solicitud, y si
        resulta procedente, la haremos efectiva dentro de los <b>15 días hábiles</b> siguientes a la respuesta.
      </p>

      <h2>8. Opciones para limitar el uso o divulgación</h2>
      <p>
        Puedes en todo momento desactivar el enlace público de un árbol, quitar el acceso a las personas con quienes lo
        compartiste, borrar personas o fotografías, o eliminar tu cuenta.
      </p>

      <h2>9. Cookies y tecnologías similares</h2>
      <p>
        Usamos únicamente una cookie esencial de sesión y el almacenamiento local de tu navegador para preferencias de la
        interfaz. No usamos cookies de publicidad, analítica ni de terceros. Consulta la <a href="?legal=cookies">Política de Cookies</a>.
      </p>

      <h2>10. Medidas de seguridad</h2>
      <p>
        Aplicamos medidas administrativas, técnicas y físicas para proteger tus datos: conexión cifrada (HTTPS), contraseñas
        cifradas, cookies de sesión protegidas, control de acceso por árbol, límites de intentos, registro solo por
        invitación y respaldos de la base de datos. En caso de una vulneración de seguridad que afecte de forma
        significativa tus derechos, te lo informaremos sin dilación para que puedas tomar medidas.
      </p>

      <h2>11. Conservación de los datos</h2>
      <p>
        Conservamos tus datos mientras tu cuenta esté activa. Al eliminar tu cuenta se borran de inmediato tu cuenta, tus
        sesiones y los árboles de los que eres dueño; las fotografías sin uso se eliminan automáticamente en un plazo
        máximo de 7 días, y las copias de respaldo se sobrescriben conforme a su ciclo de rotación.
      </p>

      <h2>12. Cambios a este aviso</h2>
      <p>
        Cualquier cambio se publicará en esta página y se te pedirá aceptarlo dentro de la aplicación antes de continuar
        usándola.
      </p>

      <h2>13. Autoridad</h2>
      <p>
        Si consideras que tu derecho a la protección de datos personales ha sido vulnerado, puedes acudir a la autoridad
        competente en la materia (actualmente, la Secretaría Anticorrupción y Buen Gobierno).
      </p>
    </>
  );
}

function Terms({ c }: { c: LegalConfig }) {
  const who = <V v={c.controller.name} ph="Nombre del responsable — LEGAL_CONTROLLER_NAME" />;
  return (
    <>
      <p>
        Estos Términos regulan el uso de Raíces, servicio ofrecido por {who}. Al crear una cuenta confirmas que los leíste
        y aceptas, junto con el <a href="?legal=privacidad">Aviso de Privacidad</a>.
      </p>
      <h2>1. Cuenta</h2>
      <ul>
        <li>El registro es sólo por invitación y está reservado a personas mayores de edad.</li>
        <li>Eres responsable de mantener la confidencialidad de tu contraseña y de la actividad de tu cuenta.</li>
        <li>Puedes eliminar tu cuenta en cualquier momento desde <i>Mi cuenta</i>.</li>
      </ul>
      <h2>2. Tu contenido y datos de terceros</h2>
      <ul>
        <li>Conservas la titularidad de la información y fotografías que subes. Nos otorgas sólo el permiso necesario para almacenarlas y mostrarlas a quienes tú autorices.</li>
        <li>Te comprometes a registrar datos de otras personas únicamente con su consentimiento o un interés legítimo, y en el caso de menores de edad, con la autorización de quien ejerce la patria potestad o tutela.</li>
        <li>No debes subir contenido ilícito, que infrinja derechos de autor o de imagen de terceros, ni datos sensibles sin consentimiento expreso.</li>
      </ul>
      <h2>3. Compartir</h2>
      <p>
        Tú decides con quién compartir un árbol y si activar un enlace público. Quien tenga el enlace público podrá ver y
        descargar el árbol; puedes desactivarlo o regenerarlo en cualquier momento.
      </p>
      <h2>4. Uso aceptable</h2>
      <p>
        No está permitido intentar acceder a cuentas o árboles ajenos, interferir con el funcionamiento del servicio ni
        usarlo para fines ilícitos. El administrador puede suspender cuentas que incumplan estos Términos.
      </p>
      <h2>5. Disponibilidad y responsabilidad</h2>
      <p>
        El servicio se ofrece "tal cual". Procuramos su disponibilidad y la integridad de la información, pero te
        recomendamos exportar periódicamente tus árboles (PDF, PNG o GEDCOM) como respaldo propio. En la medida permitida
        por la ley, no somos responsables por daños indirectos derivados del uso o la imposibilidad de uso del servicio.
      </p>
      <h2>6. Cambios</h2>
      <p>Podemos actualizar estos Términos; te pediremos aceptar la nueva versión dentro de la aplicación.</p>
      <h2>7. Ley aplicable</h2>
      <p>
        Estos Términos se rigen por las leyes de los Estados Unidos Mexicanos. Para su interpretación y cumplimiento las
        partes se someten a los tribunales competentes del domicilio del responsable, sin perjuicio de los derechos que la
        legislación de protección al consumidor te otorgue.
      </p>
    </>
  );
}

function Cookies() {
  return (
    <>
      <p>Raíces usa el mínimo indispensable de tecnologías de almacenamiento en tu navegador.</p>
      <table className="legal-table">
        <thead>
          <tr><th>Nombre</th><th>Tipo</th><th>Para qué</th><th>Duración</th></tr>
        </thead>
        <tbody>
          <tr><td><code>sid</code></td><td>Cookie esencial (HttpOnly, Secure)</td><td>Mantener tu sesión iniciada de forma segura</td><td>30 días o hasta cerrar sesión</td></tr>
          <tr><td><code>raices.*</code></td><td>Almacenamiento local</td><td>Recordar preferencias de la interfaz (secciones abiertas, aviso de cookies)</td><td>Hasta que lo borres</td></tr>
        </tbody>
      </table>
      <p>
        <b>No usamos</b> cookies de publicidad, analítica, redes sociales ni de terceros, y no rastreamos tu actividad en
        otros sitios. Como sólo usamos tecnologías esenciales para que el servicio funcione, no requieren tu consentimiento
        adicional; aun así puedes eliminarlas desde la configuración de tu navegador (tendrás que volver a iniciar sesión).
      </p>
    </>
  );
}

export function LegalFooter() {
  return (
    <footer className="legal-footer">
      <a href="?legal=privacidad">Aviso de Privacidad</a>
      <span>·</span>
      <a href="?legal=terminos">Términos y Condiciones</a>
      <span>·</span>
      <a href="?legal=cookies">Cookies</a>
    </footer>
  );
}

export function LegalPage({ doc, onBack }: { doc: LegalDoc; onBack: () => void }) {
  const [c, setC] = useState<LegalConfig | null>(null);
  useEffect(() => {
    api.legal().then(setC).catch(() => setC({ version: '', controller: { name: null, address: null, email: null }, siteUrl: null, configured: false }));
    window.scrollTo(0, 0);
  }, [doc]);
  const icon: Record<LegalDoc, ReactNode> = { privacidad: <ShieldCheck size={22} />, terminos: <FileText size={22} />, cookies: <Cookie size={22} /> };
  return (
    <div className="legal">
      <button className="btn ghost" onClick={onBack}><ArrowLeft size={16} /> Volver</button>
      <article className="legal-doc card">
        <header>
          <span className="legal-icon">{icon[doc]}</span>
          <div>
            <h1>{TITLES[doc]}</h1>
            {c && <p className="muted">Versión {c.version} · Última actualización: {c.version}</p>}
          </div>
        </header>
        {!c ? <p className="muted">Cargando…</p> : doc === 'privacidad' ? <Privacy c={c} /> : doc === 'terminos' ? <Terms c={c} /> : <Cookies />}
      </article>
      <LegalFooter />
    </div>
  );
}
