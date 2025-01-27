import React, { useCallback, useState } from 'react';

const MessagePart = ({ part, onCommand }) => {
  const [showMobileTooltip, setShowMobileTooltip] = useState(false);
  const [touchTimer, setTouchTimer] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e) => {
    const target = e.currentTarget;
    target.style.setProperty('--mouse-x', `${e.clientX}px`);
    target.style.setProperty('--mouse-y', `${e.clientY}px`);
  }, []);

  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    const target = e.currentTarget;
    
    // Store touch position for tooltip
    setTooltipPosition({
      x: touch.clientX,
      y: touch.clientY
    });

    // Start a timer for long press
    const timer = setTimeout(() => {
      setShowMobileTooltip(true);
      // Prevent scroll while tooltip is shown
      document.body.style.overflow = 'hidden';
    }, 500); // 500ms for long press

    setTouchTimer(timer);
  }, []);

  const handleTouchEnd = useCallback((e) => {
    // Clear the timer if touch ends before long press
    if (touchTimer) {
      clearTimeout(touchTimer);
      setTouchTimer(null);
    }
    
    // If tooltip was shown, prevent the click
    if (showMobileTooltip) {
      e.preventDefault();
      setShowMobileTooltip(false);
      document.body.style.overflow = '';
    }
  }, [touchTimer, showMobileTooltip]);

  const handleTouchMove = useCallback((e) => {
    // Cancel long press if user moves finger
    if (touchTimer) {
      clearTimeout(touchTimer);
      setTouchTimer(null);
    }
    if (showMobileTooltip) {
      setShowMobileTooltip(false);
      document.body.style.overflow = '';
    }
  }, [touchTimer, showMobileTooltip]);

  // Handle legacy string parts during transition
  if (typeof part === 'string') {
    return <span className="message-part">{part}</span>;
  }

  const getPartClass = () => {
    const classes = ['message-part'];
    if (part.type) {
      classes.push(`message-${part.type}`);
    }
    if (part.interactable) {
      classes.push('interactive-element');
    }
    if (showMobileTooltip) {
      classes.push('showing-tooltip');
    }
    return classes.join(' ');
  };

  const handleClick = (e) => {
    // Only handle click if not showing tooltip
    if (!showMobileTooltip && part.interactable?.actions?.click) {
      onCommand?.(part.interactable.actions.click);
    }
  };

  return (
    <span 
      className={getPartClass()}
      onClick={handleClick}
      data-tooltip={part.interactable?.tooltip || ''}
      data-entity-id={part.entityId || undefined}
      onMouseMove={part.interactable ? handleMouseMove : undefined}
      onTouchStart={part.interactable ? handleTouchStart : undefined}
      onTouchEnd={part.interactable ? handleTouchEnd : undefined}
      onTouchMove={part.interactable ? handleTouchMove : undefined}
      style={showMobileTooltip ? {
        '--touch-x': `${tooltipPosition.x}px`,
        '--touch-y': `${tooltipPosition.y}px`
      } : undefined}
    >
      {part.content}
      {showMobileTooltip && part.interactable?.tooltip && (
        <div className="mobile-tooltip">
          {part.interactable.tooltip}
        </div>
      )}
    </span>
  );
};

export default MessagePart; 