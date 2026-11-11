import {Nav, Navbar} from 'react-bootstrap';
import {FaInfoCircle, FaMoon, FaReact, FaSun} from 'react-icons/fa';
import {useTheme} from './ThemeContext.jsx';

export function Header() {
    const version = import.meta.env.VITE_APP_VERSION;
    const {theme, toggleTheme} = useTheme();
    return (
        <Navbar className="px-3 text-nowrap" bg="body-tertiary" expand="lg">
            <Navbar.Brand href="#" className="d-inline-flex align-items-baseline">
                <FaReact className="me-2 align-self-center"/>
                <span className="me-1">戴森球计划量化计算器</span>
                <span className="text-muted ssmall">v{version}</span>
            </Navbar.Brand>
            <Navbar.Toggle aria-controls="navbarNav"/>
            <Navbar.Collapse id="navbarNav">
                <Nav>
                    <Nav.Link href="https://github.com/valormx/dsp-calc">开源仓库</Nav.Link>
                    <Nav.Link href="https://www.bilibili.com/read/readlist/rl630834" target="_blank">逻辑原理</Nav.Link>
                </Nav>

                <span className="navbar-text ms-auto small me-3">
                    <FaInfoCircle/> 若无法加载，尝试切换浏览器为Chrome/Edge
                </span>
                <Nav>
                    <Nav.Link
                        href="#"
                        className="d-flex align-items-center"
                        onClick={toggleTheme}
                        title={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
                    >
                        {theme === 'light' ? <FaMoon/> : <FaSun/>}
                    </Nav.Link>
                </Nav>
            </Navbar.Collapse>
        </Navbar>
    );
}